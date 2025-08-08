import { validationResult } from 'express-validator';
import supabase from '../config/postgres.js';

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



// Add this debugging version to your course.controller.js

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




// Export controller functions
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
  handleValidationErrors
};