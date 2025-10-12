import { validationResult } from 'express-validator';
import supabase from '../config/postgres.js';
import crypto from 'crypto';


// Utility functions
const createErrorResponse = (message, errors = null) => ({
  success: false,
  message,
  ...(errors && { errors })
});

const createSuccessResponse = (data, message = null) => ({
  success: true,
  ...(message && { message }),
  ...data
});

const sanitizeCourse = (course) => ({
  id: course.id,
  title: course.title,
  code: course.code,
  subject: course.subject,
  description: course.description,
  teacher: course.teacher,
  isActive: course.is_active,
  modules: course.modules || [],
  createdAt: course.created_at,
  updatedAt: course.updated_at
});

// Validation helper
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(createErrorResponse('Validation failed', errors.array()));
  }
  next();
};

// Database operations
const createCourseInDB = async (courseData) => {
  const { data, error } = await supabase
    .from('courses')
    .insert([{
      title: courseData.title,
      code: courseData.code,
      subject: courseData.subject,
      description: courseData.description,
      instructor_id: courseData.teacher,
      is_active: true
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
};

const addCourseToTeacher = async (teacherId, courseId) => {
  const { error } = await supabase
    .from('teaching_assignments')
    .insert([{
      teacher_id: teacherId,
      course_id: courseId
    }]);

  if (error) throw error;
};

const findCoursesWithFilters = async (filters, userId, userRole) => {
  let query = supabase
    .from('courses')
    .select(`
      *,
      teacher:users!instructor_id(id, first_name, last_name, email),
      enrollments:course_enrollments(
        student:users(id, first_name, last_name, email)
      )
    `);

  // Apply filters
  if (filters.subject) {
    query = query.eq('subject', filters.subject);
  }

  if (filters.isActive !== undefined) {
    query = query.eq('is_active', filters.isActive);
  }

  // Role-based filtering
  if (userRole === 'teacher') {
    query = query.eq('instructor_id', userId);
  } else if (userRole === 'student') {
    query = query
      .select(`
        *,
        teacher:users!instructor_id(id, first_name, last_name, email),
        enrollments:course_enrollments!inner(
          student:users(id, first_name, last_name, email)
        )
      `)
      .eq('enrollments.student_id', userId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
};

// const findCourseById = async (id) => {
//   const { data, error } = await supabase
//     .from('courses')
//     .select(`
//       *,
//       teacher:users!instructor_id(id, first_name, last_name, email),
//       enrollments:course_enrollments(
//         student:users(id, first_name, last_name, email)
//       )
//     `)
//     .eq('id', id)
//     .single();

//   if (error && error.code !== 'PGRST116') throw error;
//   return data;
// };

const updateCourseById = async (id, updates) => {
  const { data, error } = await supabase
    .from('courses')
    .update({
      title: updates.title,
      code: updates.code,
      subject: updates.subject,
      description: updates.description,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
};

const deactivateCourse = async (id) => {
  const { data, error } = await supabase
    .from('courses')
    .update({
      is_active: false,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
};

const enrollStudentInCourse = async (courseId, studentId) => {
  const { data, error } = await supabase
    .from('course_enrollments')
    .insert([{
      course_id: courseId,
      student_id: studentId,
      enrolled_at: new Date().toISOString()
    }])
    .select();

  if (error) throw error;
  return data;
};

const unenrollStudentFromCourse = async (courseId, studentId) => {
  const { error } = await supabase
    .from('course_enrollments')
    .delete()
    .eq('course_id', courseId)
    .eq('student_id', studentId);

  if (error) throw error;
};

const addModuleToCourse = async (courseId, moduleData) => {
  // First get existing modules
  const { data: course, error: fetchError } = await supabase
    .from('courses')
    .select('modules')
    .eq('id', courseId)
    .single();

  if (fetchError) throw fetchError;

  const existingModules = course.modules || [];
  const updatedModules = [...existingModules, moduleData];

  const { data, error } = await supabase
    .from('courses')
    .update({
      modules: updatedModules,
      updated_at: new Date().toISOString()
    })
    .eq('id', courseId)
    .select()
    .single();

  if (error) throw error;
  return data;
};

// Controller functions
const createCourse = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(createErrorResponse('Validation failed', errors.array()));
    }

    const courseData = {
      ...req.body,
      teacher: req.user.id
    };

    const course = await createCourseInDB(courseData);
    await addCourseToTeacher(req.user.id, course.id);

    res.status(201).json(createSuccessResponse({
      course: sanitizeCourse(course)
    }));
  } catch (error) {
    console.error('Create course error:', error);
    res.status(500).json(createErrorResponse(error.message));
  }
};

const getCourses = async (req, res) => {
  try {
    const { subject, isActive } = req.query;
    const filters = {};

    if (subject) filters.subject = subject;
    if (isActive !== undefined) filters.isActive = isActive === 'true';

    const courses = await findCoursesWithFilters(filters, req.user.id, req.user.role);

    const sanitizedCourses = courses.map(course => ({
      ...sanitizeCourse(course),
      teacher: course.teacher ? {
        id: course.teacher.id,
        firstName: course.teacher.first_name,
        lastName: course.teacher.last_name,
        email: course.teacher.email
      } : null,
      students: course.enrollments?.map(enrollment => ({
        id: enrollment.student.id,
        firstName: enrollment.student.first_name,
        lastName: enrollment.student.last_name,
        email: enrollment.student.email
      })) || []
    }));

    res.json(createSuccessResponse({
      count: sanitizedCourses.length,
      courses: sanitizedCourses
    }));
  } catch (error) {
    console.error('Get courses error:', error);
    res.status(500).json(createErrorResponse(error.message));
  }
};




const getCourse = async (req, res) => {
  try {
    const courseId = req.params.id;
    console.log('🔍 Fetching course:', courseId);

    // Try the original findCourseById first
    const course = await findCourseById(courseId);
    console.log('📋 Raw course data from DB:', JSON.stringify(course, null, 2));

    if (!course) {
      console.log('❌ Course not found');
      return res.status(404).json(createErrorResponse('Course not found'));
    }

    // Check if enrollments are included
    console.log('👥 Enrollments in course:', course.enrollments?.length || 0);

    if (course.enrollments) {
      console.log('📝 Enrollment details:', course.enrollments);
    }

    const sanitizedCourse = {
      ...sanitizeCourse(course),
      teacher: course.teacher ? {
        id: course.teacher.id,
        firstName: course.teacher.first_name,
        lastName: course.teacher.last_name,
        email: course.teacher.email
      } : null,
      students: course.enrollments?.map(enrollment => ({
        id: enrollment.student?.id,
        firstName: enrollment.student?.first_name,
        lastName: enrollment.student?.last_name,
        email: enrollment.student?.email,
        enrolledAt: enrollment.enrolled_at,
        status: enrollment.status,
        grade: enrollment.grade,
        finalScore: enrollment.final_score
      })) || [],
      enrolledStudents: course.enrollments?.map(enrollment => ({
        id: enrollment.student?.id,
        firstName: enrollment.student?.first_name,
        lastName: enrollment.student?.last_name,
        email: enrollment.student?.email,
        enrolledAt: enrollment.enrolled_at,
        status: enrollment.status,
        grade: enrollment.grade,
        finalScore: enrollment.final_score
      })) || []
    };

    console.log('✅ Sanitized course students count:', sanitizedCourse.enrolledStudents?.length || 0);
    console.log('📊 Final response students:', sanitizedCourse.enrolledStudents);

    res.json(createSuccessResponse({
      course: sanitizedCourse
    }));
  } catch (error) {
    console.error('❌ Get course error:', error);
    res.status(500).json(createErrorResponse(error.message));
  }
};

// Also add debugging to your findCourseById function
const findCourseById = async (id) => {
  console.log('🔍 Finding course by ID:', id);

  const { data, error } = await supabase
    .from('courses')
    .select(`
      *,
      teacher:users!instructor_id(id, first_name, last_name, email),
      enrollments:course_enrollments(
        id,
        enrolled_at,
        status,
        grade,
        final_score,
        student:users!course_enrollments_student_id_fkey(
          id,
          first_name,
          last_name,
          email
        )
      )
    `)
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.log('❌ Database error:', error);
    throw error;
  }

  console.log('📊 Raw DB response:', JSON.stringify(data, null, 2));
  return data;
};


const updateCourse = async (req, res) => {
  try {
    const course = await updateCourseById(req.params.id, req.body);

    if (!course) {
      return res.status(404).json(createErrorResponse('Course not found'));
    }

    res.json(createSuccessResponse({
      course: sanitizeCourse(course)
    }));
  } catch (error) {
    console.error('Update course error:', error);
    res.status(500).json(createErrorResponse(error.message));
  }
};

const deleteCourse = async (req, res) => {
  try {
    const course = await deactivateCourse(req.params.id);

    if (!course) {
      return res.status(404).json(createErrorResponse('Course not found'));
    }

    res.json(createSuccessResponse({}, 'Course deactivated successfully'));
  } catch (error) {
    console.error('Delete course error:', error);
    res.status(500).json(createErrorResponse(error.message));
  }
};

const enrollStudent = async (req, res) => {
  try {
    const { studentId } = req.body;
    const courseId = req.params.id;

    // Check if course exists
    const course = await findCourseById(courseId);
    if (!course) {
      return res.status(404).json(createErrorResponse('Course not found'));
    }

    await enrollStudentInCourse(courseId, studentId);

    // Get updated course data
    const updatedCourse = await findCourseById(courseId);

    res.json(createSuccessResponse({
      course: sanitizeCourse(updatedCourse)
    }, 'Student enrolled successfully'));
  } catch (error) {
    console.error('Enroll student error:', error);
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json(createErrorResponse('Student is already enrolled in this course'));
    }
    res.status(500).json(createErrorResponse(error.message));
  }
};


const findStudentByEmail = async (email) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, first_name, last_name, email, role, is_active')
    .eq('email', email)
    .eq('role', 'student')
    .eq('is_active', true)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
};

// Helper function to check if student is already enrolled
const checkExistingEnrollment = async (courseId, studentId) => {
  const { data, error } = await supabase
    .from('course_enrollments')
    .select('id')
    .eq('course_id', courseId)
    .eq('student_id', studentId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
};

// Main controller function for enrolling student by email
const enrollStudentByEmail = async (req, res) => {
  try {
    const { email } = req.body;
    const courseId = req.params.id;

    console.log('Enrolling student by email:', email, 'in course:', courseId);

    // Check if course exists
    const course = await findCourseById(courseId);
    if (!course) {
      return res.status(404).json(createErrorResponse('Course not found'));
    }

    // Find student by email
    const student = await findStudentByEmail(email.toLowerCase().trim());
    if (!student) {
      return res.status(404).json(createErrorResponse('No student found with this email address'));
    }

    console.log('Found student:', student);

    // Check if student is already enrolled
    const existingEnrollment = await checkExistingEnrollment(courseId, student.id);
    if (existingEnrollment) {
      return res.status(400).json(createErrorResponse('Student is already enrolled in this course'));
    }

    // Enroll the student
    await enrollStudentInCourse(courseId, student.id);

    // Get updated course data with enrolled students
    const updatedCourse = await findCourseById(courseId);

    console.log('Successfully enrolled student');

    res.json(createSuccessResponse({
      course: sanitizeCourse(updatedCourse),
      enrolledStudent: {
        id: student.id,
        firstName: student.first_name,
        lastName: student.last_name,
        email: student.email
      }
    }, `${student.first_name} ${student.last_name} has been enrolled successfully`));
  } catch (error) {
    console.error('Enroll student by email error:', error);
    res.status(500).json(createErrorResponse(error.message));
  }
};

const unenrollStudent = async (req, res) => {
  try {
    const { studentId } = req.body;
    const courseId = req.params.id;

    // Check if course exists
    const course = await findCourseById(courseId);
    if (!course) {
      return res.status(404).json(createErrorResponse('Course not found'));
    }

    await unenrollStudentFromCourse(courseId, studentId);

    // Get updated course data
    const updatedCourse = await findCourseById(courseId);

    res.json(createSuccessResponse({
      course: sanitizeCourse(updatedCourse)
    }, 'Student unenrolled successfully'));
  } catch (error) {
    console.error('Unenroll student error:', error);
    res.status(500).json(createErrorResponse(error.message));
  }
};

const addModule = async (req, res) => {
  try {
    const courseId = req.params.id;
    const moduleData = req.body;

    const course = await addModuleToCourse(courseId, moduleData);

    if (!course) {
      return res.status(404).json(createErrorResponse('Course not found'));
    }

    res.json(createSuccessResponse({
      course: sanitizeCourse(course)
    }, 'Module added successfully'));
  } catch (error) {
    console.error('Add module error:', error);
    res.status(500).json(createErrorResponse(error.message));
  }
};

// Add this function to your courses controller
const getUserEnrolledCourses = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, subject } = req.query;

    // Build the query to get courses the user is enrolled in
    let query = supabase
      .from('course_enrollments')
      .select(`
        id,
        enrolled_at,
        status,
        grade,
        final_score,
        notes,
        course:courses(
          id,
          title,
          code,
          subject,
          description,
          is_active,
          modules,
          created_at,
          updated_at,
          teacher:users!instructor_id(
            id,
            first_name,
            last_name,
            email
          )
        )
      `)
      .eq('student_id', userId);

    // Apply optional filters
    if (status) {
      query = query.eq('status', status);
    }

    if (subject) {
      query = query.eq('course.subject', subject);
    }

    // Only show active courses by default
    query = query.eq('course.is_active', true);

    const { data: enrollments, error } = await query.order('enrolled_at', { ascending: false });

    if (error) {
      throw error;
    }

    // Transform the data to match your existing format
    const enrolledCourses = enrollments.map(enrollment => ({
      enrollmentId: enrollment.id,
      enrolledAt: enrollment.enrolled_at,
      enrollmentStatus: enrollment.status,
      grade: enrollment.grade,
      finalScore: enrollment.final_score,
      notes: enrollment.notes,
      course: {
        id: enrollment.course.id,
        title: enrollment.course.title,
        code: enrollment.course.code,
        subject: enrollment.course.subject,
        description: enrollment.course.description,
        isActive: enrollment.course.is_active,
        modules: enrollment.course.modules || [],
        createdAt: enrollment.course.created_at,
        updatedAt: enrollment.course.updated_at,
        teacher: enrollment.course.teacher ? {
          id: enrollment.course.teacher.id,
          firstName: enrollment.course.teacher.first_name,
          lastName: enrollment.course.teacher.last_name,
          email: enrollment.course.teacher.email
        } : null
      }
    }));

    res.json(createSuccessResponse({
      count: enrolledCourses.length,
      enrollments: enrolledCourses
    }));

  } catch (error) {
    console.error('Get user enrolled courses error:', error);
    res.status(500).json(createErrorResponse(error.message));
  }
};

// Alternative simpler version - just get the courses without detailed enrollment info
const getUserCourses = async (req, res) => {
  try {
    const userId = req.user.id;
    const { subject, status = 'active' } = req.query;

    let query = supabase
      .from('courses')
      .select(`
        *,
        teacher:users!instructor_id(id, first_name, last_name, email),
        enrollment:course_enrollments!inner(
          id,
          enrolled_at,
          status,
          grade,
          final_score,
          notes
        )
      `)
      .eq('course_enrollments.student_id', userId)
      .eq('is_active', true);

    // Apply filters
    if (subject) {
      query = query.eq('subject', subject);
    }

    if (status) {
      query = query.eq('course_enrollments.status', status);
    }

    const { data: courses, error } = await query.order('course_enrollments.enrolled_at', { ascending: false });

    if (error) {
      throw error;
    }

    const sanitizedCourses = courses.map(course => ({
      ...sanitizeCourse(course),
      teacher: course.teacher ? {
        id: course.teacher.id,
        firstName: course.teacher.first_name,
        lastName: course.teacher.last_name,
        email: course.teacher.email
      } : null,
      enrollment: {
        id: course.enrollment[0].id,
        enrolledAt: course.enrollment[0].enrolled_at,
        status: course.enrollment[0].status,
        grade: course.enrollment[0].grade,
        finalScore: course.enrollment[0].final_score,
        notes: course.enrollment[0].notes
      }
    }));

    res.json(createSuccessResponse({
      count: sanitizedCourses.length,
      courses: sanitizedCourses
    }));

  } catch (error) {
    console.error('Get user courses error:', error);
    res.status(500).json(createErrorResponse(error.message));
  }
};




const findCourseByCode = async (courseCode) => {
  const { data, error } = await supabase
    .from('courses')
    .select(`
      id,
      title,
      code,
      subject,
      instructor_id,
      is_active,
      max_students,
      current_enrollment,
      teacher:users!instructor_id(id, first_name, last_name, email)
    `)
    .eq('code', courseCode.toUpperCase())
    .eq('is_active', true)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
};

const checkExistingRegistrationRequest = async (courseId, studentId) => {
  const { data, error } = await supabase
    .from('course_registration_requests')
    .select('id, status')
    .eq('course_id', courseId)
    .eq('student_id', studentId)
    .eq('status', 'pending')
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
};



const createRegistrationRequest = async (courseId, studentId, courseCode) => {
  const { data, error } = await supabase
    .from('course_registration_requests')
    .insert([{
      course_id: courseId,
      student_id: studentId,
      course_code: courseCode.toUpperCase(),
      status: 'pending'
    }])
    .select(`
      id,
      course_code,
      status,
      requested_at,
      course:courses(id, title, code, subject)
    `)
    .single();

  if (error) throw error;
  return data;
};


const updateRegistrationRequest = async (requestId, updates, processedBy) => {
  const updateData = {
    status: updates.status,
    processed_at: new Date().toISOString(),
    processed_by: processedBy,
    updated_at: new Date().toISOString()
  };

  if (updates.notes) updateData.notes = updates.notes;
  if (updates.rejectionReason) updateData.rejection_reason = updates.rejectionReason;

  const { data, error } = await supabase
    .from('course_registration_requests')
    .update(updateData)
    .eq('id', requestId)
    .select(`
      id,
      status,
      processed_at,
      notes,
      rejection_reason,
      course:courses(id, title, code),
      student:users!student_id(id, first_name, last_name, email)
    `)
    .single();

  if (error) throw error;
  return data;
};



// Controller functions
const requestCourseRegistration = async (req, res) => {
  try {
    const { courseCode } = req.body;
    const studentId = req.user.id;

    // Find course by code
    const course = await findCourseByCode(courseCode);

    if (!course) {
      return res.status(404).json(createErrorResponse(
        `Course with code "${courseCode}" not found. Please check the course code and try again.`
      ));
    }

    // Check if course is at capacity
    if (course.current_enrollment >= course.max_students) {
      return res.status(400).json(createErrorResponse(
        `Course "${course.title}" (${course.code}) is currently at full capacity. Please contact the instructor for more information.`
      ));
    }

    // Check if student is already enrolled
    const existingEnrollment = await checkExistingEnrollment(course.id, studentId);
    if (existingEnrollment) {
      return res.status(400).json(createErrorResponse(
        `You are already enrolled in course "${course.title}" (${course.code}).`
      ));
    }

    // Check for existing pending request
    const existingRequest = await checkExistingRegistrationRequest(course.id, studentId);
    if (existingRequest) {
      return res.status(400).json(createErrorResponse(
        `You already have a pending registration request for course "${course.title}" (${course.code}). Please wait for the instructor to process your request.`
      ));
    }

    // Create registration request
    const registrationRequest = await createRegistrationRequest(course.id, studentId, courseCode);

    res.status(201).json(createSuccessResponse({
      registrationRequest: {
        id: registrationRequest.id,
        courseCode: registrationRequest.course_code,
        courseTitle: registrationRequest.course.title,
        status: registrationRequest.status,
        requestedAt: registrationRequest.requested_at
      }
    }, 'Registration request submitted successfully. You will be notified when the instructor processes your request.'));

  } catch (error) {
    console.error('Course registration request error:', error);
    res.status(500).json(createErrorResponse('Failed to submit registration request. Please try again.'));
  }
};



// Replace these functions in your course.controller.js

const getRegistrationRequestsForInstructor = async (instructorId) => {
  try {
    // First, get all courses where the user is an instructor
    const { data: instructorCourses, error: courseError } = await supabase
      .from('courses')
      .select('id')
      .eq('instructor_id', instructorId);

    if (courseError) throw courseError;

    // Also get courses from teaching_assignments
    const { data: teachingAssignments, error: teachingError } = await supabase
      .from('teaching_assignments')
      .select('course_id')
      .eq('teacher_id', instructorId);

    if (teachingError) throw teachingError;

    // Combine course IDs
    const courseIds = new Set([
      ...instructorCourses.map(c => c.id),
      ...teachingAssignments.map(ta => ta.course_id)
    ]);

    const courseIdsArray = Array.from(courseIds);

    if (courseIdsArray.length === 0) {
      return []; // No courses, no requests
    }

    // Now get registration requests for these courses
    const { data: requests, error: requestsError } = await supabase
      .from('course_registration_requests')
      .select(`
        id,
        course_code,
        status,
        requested_at,
        processed_at,
        notes,
        rejection_reason,
        course:courses(id, title, code, subject),
        student:users!student_id(id, first_name, last_name, email)
      `)
      .in('course_id', courseIdsArray)
      .order('requested_at', { ascending: false });

    if (requestsError) throw requestsError;

    return requests || [];

  } catch (error) {
    console.error('Error in getRegistrationRequestsForInstructor:', error);
    throw error;
  }
};

const getStudentRegistrationRequests = async (studentId) => {
  const { data, error } = await supabase
    .from('course_registration_requests')
    .select(`
      id,
      course_code,
      status,
      requested_at,
      processed_at,
      notes,
      rejection_reason,
      course:courses(
        id, 
        title, 
        code, 
        subject,
        teacher:users!instructor_id(first_name, last_name)
      )
    `)
    .eq('student_id', studentId)
    .order('requested_at', { ascending: false });

  if (error) throw error;
  return data || [];
};

const findRegistrationRequestById = async (requestId, instructorId) => {
  try {
    // First get the registration request
    const { data: request, error: requestError } = await supabase
      .from('course_registration_requests')
      .select(`
        id,
        course_id,
        student_id,
        status
      `)
      .eq('id', requestId)
      .single();

    if (requestError && requestError.code !== 'PGRST116') throw requestError;
    if (!request) return null;

    // Check if instructor has permission for this course
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('id, instructor_id')
      .eq('id', request.course_id)
      .single();

    if (courseError && courseError.code !== 'PGRST116') throw courseError;

    // Check if instructor is the course instructor
    if (course && course.instructor_id === instructorId) {
      return request;
    }

    // Check if instructor has teaching assignment
    const { data: teachingAssignment, error: teachingError } = await supabase
      .from('teaching_assignments')
      .select('id')
      .eq('teacher_id', instructorId)
      .eq('course_id', request.course_id)
      .single();

    if (teachingError && teachingError.code !== 'PGRST116') throw teachingError;

    if (teachingAssignment) {
      return request;
    }

    return null; // No permission
  } catch (error) {
    console.error('Error in findRegistrationRequestById:', error);
    throw error;
  }
};

// Updated controller functions
const getRegistrationRequests = async (req, res) => {
  try {
    const instructorId = req.user.id;
    console.log('Getting registration requests for instructor:', instructorId);

    const requests = await getRegistrationRequestsForInstructor(instructorId);
    console.log('Found requests:', requests.length);

    const sanitizedRequests = requests.map(request => ({
      id: request.id,
      courseCode: request.course_code,
      courseTitle: request.course?.title || 'Unknown Course',
      courseSubject: request.course?.subject || 'Unknown Subject',
      studentName: request.student ? `${request.student.first_name} ${request.student.last_name}` : 'Unknown Student',
      studentEmail: request.student?.email || 'Unknown Email',
      status: request.status,
      requestedAt: request.requested_at,
      processedAt: request.processed_at,
      notes: request.notes,
      rejectionReason: request.rejection_reason
    }));

    res.json(createSuccessResponse({
      count: sanitizedRequests.length,
      requests: sanitizedRequests
    }));

  } catch (error) {
    console.error('Get registration requests error:', error);
    res.status(500).json(createErrorResponse('Failed to fetch registration requests.'));
  }
};

const processRegistrationRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status, notes, rejectionReason } = req.body;
    const instructorId = req.user.id;

    console.log('Processing registration request:', { requestId, status, instructorId });

    // Find and validate request
    const request = await findRegistrationRequestById(requestId, instructorId);

    if (!request) {
      return res.status(404).json(createErrorResponse(
        'Registration request not found or you do not have permission to process it.'
      ));
    }

    if (request.status !== 'pending') {
      return res.status(400).json(createErrorResponse(
        'This registration request has already been processed.'
      ));
    }

    // If approving, enroll the student first
    if (status === 'approved') {
      try {
        console.log('Approving request - enrolling student:', request.student_id, 'in course:', request.course_id);

        // Check if student is already enrolled (just in case)
        const existingEnrollment = await checkExistingEnrollment(request.course_id, request.student_id);
        if (!existingEnrollment) {
          await enrollStudentInCourse(request.course_id, request.student_id);
          console.log('Student enrolled successfully');
        } else {
          console.log('Student already enrolled');
        }
      } catch (enrollmentError) {
        console.error('Error enrolling student:', enrollmentError);
        return res.status(500).json(createErrorResponse(
          'Failed to enroll student. Please try again.'
        ));
      }
    }

    // Update the registration request
    const updatedRequest = await updateRegistrationRequest(
      requestId,
      { status, notes, rejectionReason },
      instructorId
    );

    const responseMessage = status === 'approved'
      ? `Registration request approved. ${updatedRequest.student.first_name} ${updatedRequest.student.last_name} has been enrolled in ${updatedRequest.course.title}.`
      : `Registration request rejected.`;

    res.json(createSuccessResponse({
      request: {
        id: updatedRequest.id,
        status: updatedRequest.status,
        processedAt: updatedRequest.processed_at,
        notes: updatedRequest.notes,
        rejectionReason: updatedRequest.rejection_reason,
        courseTitle: updatedRequest.course.title,
        studentName: `${updatedRequest.student.first_name} ${updatedRequest.student.last_name}`
      }
    }, responseMessage));

  } catch (error) {
    console.error('Process registration request error:', error);
    res.status(500).json(createErrorResponse('Failed to process registration request.'));
  }
};

const getMyRegistrationRequests = async (req, res) => {
  try {
    const studentId = req.user.id;

    const requests = await getStudentRegistrationRequests(studentId);

    const sanitizedRequests = requests.map(request => ({
      id: request.id,
      courseCode: request.course_code,
      courseTitle: request.course?.title || 'Unknown Course',
      courseSubject: request.course?.subject || 'Unknown Subject',
      instructorName: request.course?.teacher
        ? `${request.course.teacher.first_name} ${request.course.teacher.last_name}`
        : 'Unknown Instructor',
      status: request.status,
      requestedAt: request.requested_at,
      processedAt: request.processed_at,
      notes: request.notes,
      rejectionReason: request.rejection_reason
    }));

    res.json(createSuccessResponse({
      count: sanitizedRequests.length,
      requests: sanitizedRequests
    }));

  } catch (error) {
    console.error('Get my registration requests error:', error);
    res.status(500).json(createErrorResponse('Failed to fetch your registration requests.'));
  }
};


const generateRegistrationToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

const createRegistrationLink = async (courseId, createdBy, options = {}) => {
  const token = generateRegistrationToken();
  const expiresAt = options.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default 7 days
  const maxUses = options.maxUses || 1;

  const { data, error } = await supabase
    .from('course_registration_links')
    .insert([{
      course_id: courseId,
      created_by: createdBy,
      token: token,
      expires_at: expiresAt,
      max_uses: maxUses,
      notes: options.notes
    }])
    .select(`
      *,
      course:courses(id, title, code, subject),
      creator:users!created_by(id, first_name, last_name, email)
    `)
    .single();

  if (error) throw error;
  return data;
};

const findValidRegistrationLink = async (token) => {
  const { data, error } = await supabase
    .from('course_registration_links')
    .select(`
      *,
      course:courses(
        id, 
        title, 
        code, 
        subject, 
        description,
        is_active,
        max_students,
        current_enrollment,
        teacher:users!instructor_id(id, first_name, last_name, email)
      )
    `)
    .eq('token', token)
    .eq('is_used', false)
    .gt('expires_at', new Date().toISOString())
    .lt('current_uses', supabase.raw('max_uses'))
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
};

//  Controller functions to add to your existing controller
const generateCourseRegistrationLink = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(createErrorResponse('Validation failed', errors.array()));
    }

    const courseId = req.params.courseId || req.params.id;
    const createdBy = req.user.id;
    const { expiresInDays = 7, maxUses = 1, notes } = req.body;

    // Check if course exists and user has permission
    const course = await findCourseById(courseId);
    if (!course) {
      return res.status(404).json(createErrorResponse('Course not found'));
    }

    // Check if user is the instructor or has teaching assignment
    if (course.instructor_id !== req.user.id) {
      const { data: teachingAssignment, error } = await supabase
        .from('teaching_assignments')
        .select('id')
        .eq('teacher_id', req.user.id)
        .eq('course_id', courseId)
        .single();

      if (error || !teachingAssignment) {
        return res.status(403).json(createErrorResponse('You do not have permission to create registration links for this course'));
      }
    }

    // Calculate expiration date
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    // Create registration link
    const registrationLink = await createRegistrationLink(courseId, createdBy, {
      expiresAt,
      maxUses,
      notes
    });

    // Generate the full URL
    const frontendBaseUrl = process.env.FRONTEND_BASE_URL || 'http://localhost:3000';
    const registrationUrl = `${frontendBaseUrl}/register/${registrationLink.token}`;

    res.status(201).json(createSuccessResponse({
      link: {
        id: registrationLink.id,
        token: registrationLink.token,
        url: registrationUrl,
        courseTitle: registrationLink.course.title,
        courseCode: registrationLink.course.code,
        expiresAt: registrationLink.expires_at,
        maxUses: registrationLink.max_uses,
        currentUses: registrationLink.current_uses,
        notes: registrationLink.notes,
        createdAt: registrationLink.created_at
      }
    }, 'Registration link created successfully'));

  } catch (error) {
    console.error('Generate registration link error:', error);
    res.status(500).json(createErrorResponse('Failed to create registration link'));
  }
};

const validateRegistrationLink = async (req, res) => {
  try {
    const { token } = req.params;

    const registrationLink = await findValidRegistrationLink(token);

    if (!registrationLink) {
      return res.status(404).json(createErrorResponse('Invalid or expired registration link'));
    }

    // Check if course is still active and has capacity
    if (!registrationLink.course.is_active) {
      return res.status(400).json(createErrorResponse('This course is no longer active'));
    }

    if (registrationLink.course.current_enrollment >= registrationLink.course.max_students) {
      return res.status(400).json(createErrorResponse('Course is at full capacity'));
    }

    res.json(createSuccessResponse({
      course: {
        id: registrationLink.course.id,
        title: registrationLink.course.title,
        code: registrationLink.course.code,
        subject: registrationLink.course.subject,
        description: registrationLink.course.description,
        teacher: registrationLink.course.teacher ? {
          firstName: registrationLink.course.teacher.first_name,
          lastName: registrationLink.course.teacher.last_name,
          email: registrationLink.course.teacher.email
        } : null
      },
      link: {
        expiresAt: registrationLink.expires_at,
        maxUses: registrationLink.max_uses,
        currentUses: registrationLink.current_uses,
        notes: registrationLink.notes
      }
    }));

  } catch (error) {
    console.error('Validate registration link error:', error);
    res.status(500).json(createErrorResponse('Failed to validate registration link'));
  }
};

const registerViaLink = async (req, res) => {
  try {
    const { token } = req.params;
    const studentId = req.user.id;

    // Validate the registration link
    const registrationLink = await findValidRegistrationLink(token);

    if (!registrationLink) {
      return res.status(404).json(createErrorResponse('Invalid or expired registration link'));
    }

    const courseId = registrationLink.course.id;

    // Check if course is still active and has capacity
    if (!registrationLink.course.is_active) {
      return res.status(400).json(createErrorResponse('This course is no longer active'));
    }

    if (registrationLink.course.current_enrollment >= registrationLink.course.max_students) {
      return res.status(400).json(createErrorResponse('Course is at full capacity'));
    }

    // Check if student is already enrolled
    const existingEnrollment = await checkExistingEnrollment(courseId, studentId);
    if (existingEnrollment) {
      return res.status(400).json(createErrorResponse(
        `You are already enrolled in "${registrationLink.course.title}"`
      ));
    }

    // Enroll the student
    await enrollStudentInCourse(courseId, studentId);

    // Mark link as used or increment usage counter
    if (registrationLink.max_uses === 1) {
      await supabase
        .from('course_registration_links')
        .update({
          is_used: true,
          used_by: studentId,
          used_at: new Date().toISOString(),
          current_uses: supabase.raw('current_uses + 1'),
          updated_at: new Date().toISOString()
        })
        .eq('id', registrationLink.id);
    } else {
      // For multi-use links, just increment the counter
      await supabase
        .from('course_registration_links')
        .update({
          current_uses: supabase.raw('current_uses + 1'),
          updated_at: new Date().toISOString()
        })
        .eq('id', registrationLink.id);
    }

    res.json(createSuccessResponse({
      course: {
        id: registrationLink.course.id,
        title: registrationLink.course.title,
        code: registrationLink.course.code,
        subject: registrationLink.course.subject,
        description: registrationLink.course.description
      },
      enrollment: {
        enrolledAt: new Date().toISOString(),
        status: 'active'
      }
    }, `Successfully enrolled in "${registrationLink.course.title}"`));

  } catch (error) {
    console.error('Register via link error:', error);

    if (error.code === '23505') {
      return res.status(400).json(createErrorResponse('You are already enrolled in this course'));
    }

    res.status(500).json(createErrorResponse('Failed to complete registration'));
  }
};

const getCourseRegistrationLinks = async (req, res) => {
  try {
    const courseId = req.params.id;
    const userId = req.user.id;

    // Check if course exists and user has permission
    const course = await findCourseById(courseId);
    if (!course) {
      return res.status(404).json(createErrorResponse('Course not found'));
    }

    // Check if user is the instructor or has teaching assignment
    if (course.instructor_id !== userId) {
      const { data: teachingAssignment, error } = await supabase
        .from('teaching_assignments')
        .select('id')
        .eq('teacher_id', userId)
        .eq('course_id', courseId)
        .single();

      if (error || !teachingAssignment) {
        return res.status(403).json(createErrorResponse('You do not have permission to view registration links for this course'));
      }
    }

    // Get registration links for this course
    const { data: links, error: linksError } = await supabase
      .from('course_registration_links')
      .select(`
        *,
        used_by_user:users!used_by(id, first_name, last_name, email),
        creator:users!created_by(id, first_name, last_name, email)
      `)
      .eq('course_id', courseId)
      .order('created_at', { ascending: false });

    if (linksError) {
      throw linksError;
    }

    const frontendBaseUrl = process.env.FRONTEND_BASE_URL || 'http://localhost:3000';
    
    const sanitizedLinks = (links || []).map(link => ({
      id: link.id,
      token: link.token,
      url: `${frontendBaseUrl}/register/${link.token}`,
      isUsed: link.is_used,
      expiresAt: link.expires_at,
      maxUses: link.max_uses,
      currentUses: link.current_uses,
      notes: link.notes,
      createdAt: link.created_at,
      usedAt: link.used_at,
      usedBy: link.used_by_user ? {
        firstName: link.used_by_user.first_name,
        lastName: link.used_by_user.last_name,
        email: link.used_by_user.email
      } : null,
      createdBy: link.creator ? {
        firstName: link.creator.first_name,
        lastName: link.creator.last_name,
        email: link.creator.email
      } : null,
      isExpired: new Date(link.expires_at) < new Date(),
      isValid: !link.is_used && new Date(link.expires_at) >= new Date() && link.current_uses < link.max_uses
    }));

    res.json(createSuccessResponse({
      count: sanitizedLinks.length,
      links: sanitizedLinks
    }));

  } catch (error) {
    console.error('Get course registration links error:', error);
    res.status(500).json(createErrorResponse('Failed to fetch registration links'));
  }
};


export {
  createCourse,
  getCourses,
  getCourse,
  updateCourse,
  deleteCourse,
  enrollStudent,
  enrollStudentByEmail,
  unenrollStudent,
  addModule,
  getUserEnrolledCourses,
  getUserCourses,
  requestCourseRegistration,
  getRegistrationRequests,
  processRegistrationRequest,
  getMyRegistrationRequests,
  findCourseByCode,
  findCourseById,
  findStudentByEmail,
  checkExistingEnrollment,
  createRegistrationRequest,
  generateCourseRegistrationLink,
  validateRegistrationLink,
  registerViaLink,
  generateRegistrationToken,
  createRegistrationLink,
  findValidRegistrationLink,
  getCourseRegistrationLinks,
  handleValidationErrors
};