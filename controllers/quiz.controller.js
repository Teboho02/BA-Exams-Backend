// controllers/quiz.controller.js
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

// Helper function to sanitize course data
const sanitizeCourse = (course) => ({
  id: course.id,
  title: course.title,
  code: course.code,
  description: course.description,
  instructor: {
    name: course.instructor_name || 'TBD',
    email: course.instructor_email || ''
  },
  enrollmentDate: course.enrolled_at,
  status: course.enrollment_status,
  finalScore: course.final_score,
  letterGrade: course.letter_grade,
  totalAssignments: course.total_assignments || 0,
  completedAssignments: course.completed_assignments || 0,
  totalPoints: course.total_points || 0,
  earnedPoints: course.earned_points || 0,
  averageGrade: course.total_points > 0 ? Math.round((course.earned_points / course.total_points) * 100) : 0
});

// Helper function to sanitize quiz/assessment data
const sanitizeQuiz = (quiz) => ({
  id: quiz.id,
  courseId: quiz.course_id,
  title: quiz.title,
  description: quiz.description || '',
  instructions: quiz.instructions || '',
  assignmentType: quiz.assignment_type,
  maxPoints: quiz.max_points,
  dueDate: quiz.due_date,
  availableFrom: quiz.available_from,
  availableUntil: quiz.available_until,
  isPublished: quiz.is_published,
  allowedAttempts: quiz.allowed_attempts,
  hasTimeLimit: quiz.has_time_limit,
  timeLimitMinutes: quiz.time_limit_minutes,
  shuffleAnswers: quiz.shuffle_answers,
  showCorrectAnswers: quiz.show_correct_answers,
  oneQuestionAtTime: quiz.one_question_at_time,
  cantGoBack: quiz.cant_go_back,
  requireAccessCode: quiz.require_access_code,
  createdAt: quiz.created_at,
  updatedAt: quiz.updated_at,
  // Submission-related fields (when available)
  submissionId: quiz.submission_id,
  submissionStatus: quiz.submission_status,
  earnedPoints: quiz.earned_points,
  submittedAt: quiz.submitted_at,
  gradedAt: quiz.graded_at,
  attemptNumber: quiz.attempt_number,
  timeSpent: quiz.time_spent_minutes,
  percentage: quiz.earned_points && quiz.max_points ? Math.round((quiz.earned_points / quiz.max_points) * 100) : null,
  feedback: quiz.feedback
});

// Helper function to determine assignment status
const determineAssignmentStatus = (quiz) => {
  if (quiz.submission_id) {
    if (quiz.graded_at) {
      return 'graded';
    } else {
      return 'pending';
    }
  } else if (quiz.due_date && new Date(quiz.due_date) < new Date()) {
    return 'missing';
  } else {
    return 'available';
  }
};

// Get all courses the user is enrolled in
export const getEnrolledCourses = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    console.log(`Fetching enrolled courses for user: ${userId} (${userRole})`);

    let query;

    // Different queries based on user role
    if (userRole === 'student') {
      // Students see courses they're enrolled in
      query = supabase
        .from('course_enrollments')
        .select(`
          id,
          enrolled_at,
          status,
          final_score,
          grade,
          courses!inner (
            id,
            title,
            code,
            description,
            instructor_id,
            users!courses_instructor_id_fkey (
              first_name,
              last_name,
              email
            )
          )
        `)
        .eq('student_id', userId)
        .eq('status', 'active')
        .order('enrolled_at', { ascending: false });

    } else if (userRole === 'teacher') {
      // Teachers see courses they teach
      query = supabase
        .from('courses')
        .select(`
          id,
          title,
          code,
          description,
          created_at as enrolled_at,
          instructor_id,
          users!courses_instructor_id_fkey (
            first_name,
            last_name,
            email
          )
        `)
        .eq('instructor_id', userId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

    } else if (userRole === 'admin') {
      // Admins see all active courses
      query = supabase
        .from('courses')
        .select(`
          id,
          title,
          code,
          description,
          created_at as enrolled_at,
          instructor_id,
          users!courses_instructor_id_fkey (
            first_name,
            last_name,
            email
          )
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
    }

    const { data: coursesData, error: coursesError } = await query;

    if (coursesError) {
      console.error('Error fetching courses:', coursesError);
      return res.status(500).json(createErrorResponse('Failed to fetch courses'));
    }

    if (!coursesData || coursesData.length === 0) {
      return res.json(createSuccessResponse({
        courses: [],
        count: 0
      }, 'No courses found'));
    }

    // Get assignment statistics for each course
    const courseIds = coursesData.map(c => userRole === 'student' ? c.courses.id : c.id);

    // Get assignment counts and scores
    const { data: assignmentStats } = await supabase
      .from('assignments')
      .select(`
        course_id,
        id,
        max_points,
        assignment_submissions!left (
          id,
          student_id,
          score,
          status
        )
      `)
      .in('course_id', courseIds)
      .eq('is_published', true);

    // Process assignment statistics
    const courseStatsMap = {};
    courseIds.forEach(courseId => {
      courseStatsMap[courseId] = {
        total_assignments: 0,
        completed_assignments: 0,
        total_points: 0,
        earned_points: 0
      };
    });

    assignmentStats?.forEach(assignment => {
      const courseId = assignment.course_id;
      const stats = courseStatsMap[courseId];
      
      stats.total_assignments += 1;
      stats.total_points += assignment.max_points || 0;

      // For students, count their specific submissions
      if (userRole === 'student') {
        const userSubmission = assignment.assignment_submissions?.find(
          sub => sub.student_id === userId && sub.status === 'graded'
        );
        if (userSubmission) {
          stats.completed_assignments += 1;
          stats.earned_points += userSubmission.score || 0;
        }
      }
    });

    // Format courses with statistics
    const coursesWithStats = coursesData.map(courseData => {
      const course = userRole === 'student' ? courseData.courses : courseData;
      const instructor = course.users;
      const stats = courseStatsMap[course.id];

      return sanitizeCourse({
        id: course.id,
        title: course.title,
        code: course.code,
        description: course.description,
        instructor_name: instructor ? `${instructor.first_name} ${instructor.last_name}`.trim() : 'TBD',
        instructor_email: instructor?.email || '',
        enrolled_at: courseData.enrolled_at || courseData.created_at,
        enrollment_status: courseData.status || 'active',
        final_score: courseData.final_score,
        letter_grade: courseData.grade || calculateLetterGrade(stats.total_points > 0 ? (stats.earned_points / stats.total_points) * 100 : 0),
        ...stats
      });
    });

    console.log(`Found ${coursesWithStats.length} courses for user ${userId}`);

    res.json(createSuccessResponse({
      courses: coursesWithStats,
      count: coursesWithStats.length,
      userRole
    }));

  } catch (error) {
    console.error('Get enrolled courses error:', error);
    res.status(500).json(createErrorResponse('Failed to fetch courses'));
  }
};


// quiz.controller.js

// Enhanced version of getFullStudentAssessmentData
export const getFullStudentAssessmentData = async (req, res) => {
  try {
    const studentId = req.user.id;

    console.log(`Fetching full assessment data for student: ${studentId}`);

    // 1. Get enrolled courses with instructor information
    const { data: enrollments, error: enrollmentError } = await supabase
      .from('course_enrollments')
      .select(`
        course_id,
        enrolled_at,
        status,
        final_score,
        grade,
        courses!inner (
          id,
          title,
          code,
          description,
          subject,
          credits,
          instructor_id,
          users!courses_instructor_id_fkey (
            first_name,
            last_name,
            email
          )
        )
      `)
      .eq('student_id', studentId)
      .eq('status', 'active')
      .order('enrolled_at', { ascending: false });

    if (enrollmentError) {
      console.error('Error fetching enrollments:', enrollmentError);
      return res.status(500).json(createErrorResponse('Failed to fetch enrollment data'));
    }

    if (!enrollments || enrollments.length === 0) {
      return res.json(createSuccessResponse({
        courses: [],
        totalCourses: 0,
        overallStats: {
          totalAssignments: 0,
          completedAssignments: 0,
          pendingAssignments: 0,
          averageGrade: 0
        }
      }, 'No enrolled courses found'));
    }

    const results = [];
    let overallStats = {
      totalAssignments: 0,
      completedAssignments: 0,
      pendingAssignments: 0,
      totalPoints: 0,
      earnedPoints: 0
    };

    for (const enrollment of enrollments) {
      const course = enrollment.courses;

      // 2. Get all assignments for the course
      const { data: assignments, error: assignmentError } = await supabase
        .from('assignments')
        .select(`
          id,
          title,
          description,
          assignment_type,
          max_points,
          due_date,
          available_from,
          available_until,
          is_published,
          allowed_attempts,
          has_time_limit,
          time_limit_minutes,
          created_at
        `)
        .eq('course_id', course.id)
        .eq('is_published', true)
        .order('due_date', { ascending: true });

      if (assignmentError) {
        console.error('Error fetching assignments:', assignmentError);
        continue; // Skip this course but continue with others
      }

      const assessments = [];
      let courseStats = {
        totalAssignments: assignments?.length || 0,
        completedAssignments: 0,
        pendingAssignments: 0,
        totalPoints: 0,
        earnedPoints: 0
      };

      if (assignments && assignments.length > 0) {
        const assignmentIds = assignments.map(a => a.id);

        // 3. Get all submissions for these assignments
        const { data: submissions, error: submissionError } = await supabase
          .from('assignment_submissions')
          .select(`
            id,
            assignment_id,
            status,
            score,
            submitted_at,
            graded_at,
            attempt_number,
            feedback,
            time_started,
            time_completed,
            EXTRACT(EPOCH FROM (time_completed - time_started))/60 as time_spent_minutes
          `)
          .eq('student_id', studentId)
          .in('assignment_id', assignmentIds)
          .order('assignment_id')
          .order('attempt_number', { ascending: false });

        if (submissionError) {
          console.error('Error fetching submissions:', submissionError);
        }

        // Create a map of latest submissions per assignment
        const submissionMap = {};
        submissions?.forEach(sub => {
          if (!submissionMap[sub.assignment_id]) {
            submissionMap[sub.assignment_id] = sub;
          }
        });

        // 4. Process each assignment with its submission data
        for (const assignment of assignments) {
          const latestSubmission = submissionMap[assignment.id];
          
          // Determine assignment status
          let status = 'available';
          const now = new Date();
          const dueDate = assignment.due_date ? new Date(assignment.due_date) : null;
          const availableFrom = assignment.available_from ? new Date(assignment.available_from) : null;
          const availableUntil = assignment.available_until ? new Date(assignment.available_until) : null;

          if (latestSubmission) {
            if (latestSubmission.status === 'graded') {
              status = 'graded';
              courseStats.completedAssignments++;
            } else {
              status = 'pending';
              courseStats.pendingAssignments++;
            }
          } else if (dueDate && dueDate < now) {
            status = 'missing';
            courseStats.pendingAssignments++;
          } else if (availableFrom && now < availableFrom) {
            status = 'upcoming';
          } else if (availableUntil && now > availableUntil) {
            status = 'expired';
          }

          // Calculate statistics
          courseStats.totalPoints += assignment.max_points || 0;
          if (latestSubmission?.score !== null && latestSubmission?.score !== undefined) {
            courseStats.earnedPoints += latestSubmission.score;
          }

          assessments.push({
            assignment: {
              id: assignment.id,
              title: assignment.title,
              description: assignment.description,
              assignmentType: assignment.assignment_type,
              maxPoints: assignment.max_points,
              dueDate: assignment.due_date,
              availableFrom: assignment.available_from,
              availableUntil: assignment.available_until,
              allowedAttempts: assignment.allowed_attempts,
              hasTimeLimit: assignment.has_time_limit,
              timeLimitMinutes: assignment.time_limit_minutes,
              createdAt: assignment.created_at,
              status: status
            },
            latestAttempt: latestSubmission ? {
              id: latestSubmission.id,
              status: latestSubmission.status,
              score: latestSubmission.score,
              percentage: assignment.max_points > 0 ? 
                Math.round((latestSubmission.score / assignment.max_points) * 100) : null,
              submittedAt: latestSubmission.submitted_at,
              gradedAt: latestSubmission.graded_at,
              attemptNumber: latestSubmission.attempt_number,
              timeSpentMinutes: latestSubmission.time_spent_minutes,
              feedback: latestSubmission.feedback
            } : null,
            allAttempts: submissions?.filter(sub => sub.assignment_id === assignment.id) || []
          });
        }
      }

      // Calculate course average
      const courseAverage = courseStats.totalPoints > 0 ? 
        Math.round((courseStats.earnedPoints / courseStats.totalPoints) * 100) : 0;

      // Add to overall stats
      overallStats.totalAssignments += courseStats.totalAssignments;
      overallStats.completedAssignments += courseStats.completedAssignments;
      overallStats.pendingAssignments += courseStats.pendingAssignments;
      overallStats.totalPoints += courseStats.totalPoints;
      overallStats.earnedPoints += courseStats.earnedPoints;

      results.push({
        course: {
          id: course.id,
          title: course.title,
          code: course.code,
          description: course.description,
          subject: course.subject,
          credits: course.credits,
          instructor: {
            name: course.users ? 
              `${course.users.first_name} ${course.users.last_name}`.trim() : 'TBD',
            email: course.users?.email || ''
          },
          enrollmentInfo: {
            enrolledAt: enrollment.enrolled_at,
            status: enrollment.status,
            finalScore: enrollment.final_score,
            grade: enrollment.grade
          }
        },
        assessments: assessments,
        courseStats: {
          ...courseStats,
          averageGrade: courseAverage,
          letterGrade: calculateLetterGrade(courseAverage)
        }
      });
    }

    // Calculate overall average
    const overallAverage = overallStats.totalPoints > 0 ? 
      Math.round((overallStats.earnedPoints / overallStats.totalPoints) * 100) : 0;

    console.log(`Found ${results.length} courses with assessment data for student ${studentId}`);

    res.json(createSuccessResponse({
      courses: results,
      totalCourses: results.length,
      overallStats: {
        ...overallStats,
        averageGrade: overallAverage,
        letterGrade: calculateLetterGrade(overallAverage),
        completionRate: overallStats.totalAssignments > 0 ? 
          Math.round((overallStats.completedAssignments / overallStats.totalAssignments) * 100) : 0
      },
      lastUpdated: new Date().toISOString()
    }, 'Assessment data retrieved successfully'));

  } catch (error) {
    console.error('Error in getFullStudentAssessmentData:', error);
    res.status(500).json(createErrorResponse('Failed to fetch assessment data'));
  }
};


// Get quizzes/assessments for a specific course
export const getCourseQuizzes = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    console.log(`Fetching quizzes for course: ${courseId}, user: ${userId} (${userRole})`);

    // Verify user has access to this course
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('id, instructor_id, title')
      .eq('id', courseId)
      .single();

    if (courseError || !course) {
      return res.status(404).json(createErrorResponse('Course not found'));
    }

    // Check access permissions
    let hasAccess = false;

    if (userRole === 'admin') {
      hasAccess = true;
    } else if (userRole === 'teacher' && course.instructor_id === userId) {
      hasAccess = true;
    } else if (userRole === 'student') {
      const { data: enrollment } = await supabase
        .from('course_enrollments')
        .select('id')
        .eq('course_id', courseId)
        .eq('student_id', userId)
        .eq('status', 'active')
        .single();

      hasAccess = !!enrollment;
    }

    if (!hasAccess) {
      return res.status(403).json(createErrorResponse('Access denied to this course'));
    }

    // Build query for quizzes/assessments
    let query = supabase
      .from('assignments')
      .select(`
        id,
        course_id,
        title,
        description,
        instructions,
        assignment_type,
        max_points,
        due_date,
        available_from,
        available_until,
        is_published,
        allowed_attempts,
        has_time_limit,
        time_limit_minutes,
        shuffle_answers,
        show_correct_answers,
        one_question_at_time,
        cant_go_back,
        require_access_code,
        created_at,
        updated_at
      `)
      .eq('course_id', courseId)
      .in('assignment_type', ['quiz', 'exam', 'assignment', 'discussion'])
      .order('created_at', { ascending: false });

    // Students only see published assignments
    if (userRole === 'student') {
      query = query.eq('is_published', true);
    }

    const { data: quizzes, error: quizzesError } = await query;

    if (quizzesError) {
      console.error('Error fetching quizzes:', quizzesError);
      return res.status(500).json(createErrorResponse('Failed to fetch quizzes'));
    }

    let quizzesWithSubmissions = quizzes || [];

    // For students, get their submission data
    if (userRole === 'student' && quizzes && quizzes.length > 0) {
      const quizIds = quizzes.map(q => q.id);

      const { data: submissions } = await supabase
        .from('assignment_submissions')
        .select(`
          id,
          assignment_id,
          status,
          score,
          submitted_at,
          graded_at,
          attempt_number,
          feedback,
          EXTRACT(EPOCH FROM (time_completed - time_started))/60 as time_spent_minutes
        `)
        .eq('student_id', userId)
        .in('assignment_id', quizIds)
        .order('attempt_number', { ascending: false });

      // Get the latest submission for each quiz
      const submissionMap = {};
      submissions?.forEach(sub => {
        if (!submissionMap[sub.assignment_id]) {
          submissionMap[sub.assignment_id] = sub;
        }
      });

      // Add submission data to quizzes
      quizzesWithSubmissions = quizzes.map(quiz => {
        const submission = submissionMap[quiz.id];
        return {
          ...quiz,
          submission_id: submission?.id || null,
          submission_status: submission?.status || null,
          earned_points: submission?.score || null,
          submitted_at: submission?.submitted_at || null,
          graded_at: submission?.graded_at || null,
          attempt_number: submission?.attempt_number || null,
          time_spent_minutes: submission?.time_spent_minutes || null,
          feedback: submission?.feedback || null
        };
      });
    }

    // For teachers, get submission counts
    if ((userRole === 'teacher' || userRole === 'admin') && quizzes && quizzes.length > 0) {
      const quizIds = quizzes.map(q => q.id);

      const { data: submissionCounts } = await supabase
        .from('assignment_submissions')
        .select('assignment_id')
        .in('assignment_id', quizIds);

      // Count submissions per quiz
      const submissionCountMap = {};
      submissionCounts?.forEach(sub => {
        submissionCountMap[sub.assignment_id] = (submissionCountMap[sub.assignment_id] || 0) + 1;
      });

      // Add submission counts to quizzes
      quizzesWithSubmissions = quizzes.map(quiz => ({
        ...quiz,
        submission_count: submissionCountMap[quiz.id] || 0
      }));
    }

    // Sanitize and add status for each quiz
    const sanitizedQuizzes = quizzesWithSubmissions.map(quiz => {
      const sanitized = sanitizeQuiz(quiz);
      
      // Add status for students
      if (userRole === 'student') {
        sanitized.status = determineAssignmentStatus(quiz);
      }
      
      return sanitized;
    });

    console.log(`Found ${sanitizedQuizzes.length} quizzes for course ${courseId}`);

    res.json(createSuccessResponse({
      quizzes: sanitizedQuizzes,
      count: sanitizedQuizzes.length,
      course: {
        id: course.id,
        title: course.title
      },
      userRole
    }));

  } catch (error) {
    console.error('Get course quizzes error:', error);
    res.status(500).json(createErrorResponse('Failed to fetch quizzes'));
  }
};

// Get specific quiz/assessment details
export const getQuizDetails = async (req, res) => {
  try {
    const { quizId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Get quiz with course information
    const { data: quiz, error: quizError } = await supabase
      .from('assignments')
      .select(`
        *,
        courses!inner (
          id,
          title,
          instructor_id
        )
      `)
      .eq('id', quizId)
      .single();

    if (quizError || !quiz) {
      return res.status(404).json(createErrorResponse('Quiz not found'));
    }

    // Check access permissions
    const isInstructor = quiz.courses.instructor_id === userId;
    const isAdmin = userRole === 'admin';
    
    let isEnrolled = false;
    if (!isInstructor && !isAdmin) {
      // Check if quiz is published for students
      if (!quiz.is_published) {
        return res.status(403).json(createErrorResponse('Quiz not available'));
      }

      const { data: enrollmentData } = await supabase
        .from('course_enrollments')
        .select('id')
        .eq('course_id', quiz.course_id)
        .eq('student_id', userId)
        .eq('status', 'active')
        .single();
      
      isEnrolled = !!enrollmentData;
    }

    if (!isInstructor && !isAdmin && !isEnrolled) {
      return res.status(403).json(createErrorResponse('Not authorized to view this quiz'));
    }

    // Get student's submissions if applicable (moved up for attempt checking)
    let submissions = [];
    let canTakeQuiz = false;
    let attemptInfo = {};

    if (isEnrolled && !isInstructor && !isAdmin) {
      const { data: submissionsData } = await supabase
        .from('assignment_submissions')
        .select(`
          id,
          status,
          score,
          submitted_at,
          graded_at,
          attempt_number,
          feedback,
          EXTRACT(EPOCH FROM (time_completed - time_started))/60 as time_spent_minutes
        `)
        .eq('assignment_id', quizId)
        .eq('student_id', userId)
        .order('attempt_number', { ascending: false });

      submissions = submissionsData || [];

      // Check attempt limits
      const maxAttempts = quiz.allowed_attempts || 1;
      const currentAttempts = submissions.length;
      const hasUnfinishedAttempt = submissions.some(sub => sub.status === 'draft');
      
      // Check if quiz is currently available
      const now = new Date();
      const availableFrom = quiz.available_from ? new Date(quiz.available_from) : null;
      const availableUntil = quiz.available_until ? new Date(quiz.available_until) : null;
      const dueDate = quiz.due_date ? new Date(quiz.due_date) : null;
      
      const isAvailable = (!availableFrom || now >= availableFrom) && 
                         (!availableUntil || now <= availableUntil) &&
                         (!dueDate || now <= dueDate);

      // Determine if student can take the quiz
      canTakeQuiz = isAvailable && 
                   quiz.is_published && 
                   (currentAttempts < maxAttempts || hasUnfinishedAttempt);

      attemptInfo = {
        currentAttempts,
        maxAttempts,
        attemptsRemaining: Math.max(0, maxAttempts - currentAttempts),
        hasUnfinishedAttempt,
        canRetake: currentAttempts < maxAttempts,
        isAvailable,
        availableFrom: quiz.available_from,
        availableUntil: quiz.available_until,
        dueDate: quiz.due_date
      };

      // If student has reached max attempts and no unfinished attempts
      if (currentAttempts >= maxAttempts && !hasUnfinishedAttempt) {
        canTakeQuiz = false;
      }
    } else {
      // For instructors/admins, they can always view
      canTakeQuiz = isInstructor || isAdmin;
    }

    // Get questions for the quiz
    let questions = [];
    if (quiz.assignment_type === 'quiz') {
      // Only show questions if user can take quiz or is instructor/admin
      if (canTakeQuiz || isInstructor || isAdmin) {
        const { data: questionsData } = await supabase
          .from('quiz_questions')
          .select(`
            id,
            question_number,
            title,
            question_text,
            question_type,
            points,
            image_url,
            quiz_question_answers (
              id,
              answer_text,
              is_correct,
              feedback,
              answer_order
            )
          `)
          .eq('assignment_id', quizId)
          .order('question_number', { ascending: true });

        if (questionsData) {
          questions = questionsData.map(q => ({
            id: q.id,
            questionNumber: q.question_number,
            title: q.title,
            questionText: q.question_text,
            questionType: q.question_type,
            points: q.points,
            imageUrl: q.image_url,
            answers: q.quiz_question_answers
              .sort((a, b) => a.answer_order - b.answer_order)
              .map(answer => ({
                id: answer.id,
                answerText: answer.answer_text,
                isCorrect: isInstructor || isAdmin ? answer.is_correct : undefined,
                feedback: answer.feedback,
                answerOrder: answer.answer_order
              }))
          }));
        }
      }
    }

    // Determine the appropriate message for students who cannot take the quiz
    let message = '';
    if (isEnrolled && !isInstructor && !isAdmin && !canTakeQuiz) {
      if (!quiz.is_published) {
        message = 'Quiz is not yet published by the instructor';
      } else if (attemptInfo.currentAttempts >= attemptInfo.maxAttempts) {
        message = `You have used all ${attemptInfo.maxAttempts} attempt(s) for this quiz`;
      } else if (!attemptInfo.isAvailable) {
        const now = new Date();
        if (attemptInfo.availableFrom && now < new Date(attemptInfo.availableFrom)) {
          message = `Quiz will be available from ${new Date(attemptInfo.availableFrom).toLocaleString()}`;
        } else if (attemptInfo.availableUntil && now > new Date(attemptInfo.availableUntil)) {
          message = 'Quiz is no longer available';
        } else if (attemptInfo.dueDate && now > new Date(attemptInfo.dueDate)) {
          message = 'Quiz due date has passed';
        }
      }
    }

    const response = {
      quiz: sanitizeQuiz(quiz),
      questions: questions,
      submissions: submissions,
      course: {
        id: quiz.courses.id,
        title: quiz.courses.title
      },
      canEdit: isInstructor || isAdmin,
      canTake: canTakeQuiz,
      attemptInfo: isEnrolled && !isInstructor && !isAdmin ? attemptInfo : undefined,
      message: message || undefined
    };

    res.json(createSuccessResponse(response));

  } catch (error) {
    console.error('Get quiz details error:', error);
    res.status(500).json(createErrorResponse('Failed to fetch quiz details'));
  }
};
// Get quiz attempt history for a student
export const getQuizAttempts = async (req, res) => {
  try {
    const { quizId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Get quiz and verify access
    const { data: quiz, error: quizError } = await supabase
      .from('assignments')
      .select(`
        *,
        courses!inner(id, instructor_id)
      `)
      .eq('id', quizId)
      .single();

    if (quizError || !quiz) {
      return res.status(404).json(createErrorResponse('Quiz not found'));
    }

    // Check permissions
    const isInstructor = quiz.courses.instructor_id === userId;
    const isAdmin = userRole === 'admin';
    
    let targetStudentId = userId;
    
    // If instructor or admin, they can see all attempts
    if (isInstructor || isAdmin) {
      // If studentId is provided in query, filter by that student
      const { studentId } = req.query;
      if (studentId) {
        targetStudentId = studentId;
      } else {
        targetStudentId = null; // Get all students' attempts
      }
    } else {
      // Students can only see their own attempts
      const { data: enrollmentData } = await supabase
        .from('course_enrollments')
        .select('id')
        .eq('course_id', quiz.course_id)
        .eq('student_id', userId)
        .eq('status', 'active')
        .single();
      
      if (!enrollmentData) {
        return res.status(403).json(createErrorResponse('Not authorized to view quiz attempts'));
      }
    }

    // Build query for attempts
    let query = supabase
      .from('assignment_submissions')
      .select(`
        id,
        student_id,
        status,
        score,
        submitted_at,
        graded_at,
        attempt_number,
        feedback,
        quiz_data,
        EXTRACT(EPOCH FROM (time_completed - time_started))/60 as time_spent_minutes,
        users!assignment_submissions_student_id_fkey (
          first_name,
          last_name,
          email
        )
      `)
      .eq('assignment_id', quizId)
      .order('submitted_at', { ascending: false });

    // Filter by student if specified
    if (targetStudentId) {
      query = query.eq('student_id', targetStudentId);
    }

    const { data: attempts, error: attemptsError } = await query;

    if (attemptsError) {
      console.error('Error fetching quiz attempts:', attemptsError);
      return res.status(500).json(createErrorResponse('Failed to fetch quiz attempts'));
    }

    // Format attempts
    const formattedAttempts = (attempts || []).map(attempt => ({
      id: attempt.id,
      studentId: attempt.student_id,
      studentName: attempt.users ? `${attempt.users.first_name} ${attempt.users.last_name}`.trim() : 'Unknown',
      studentEmail: attempt.users?.email || '',
      status: attempt.status,
      score: attempt.score,
      maxScore: quiz.max_points,
      percentage: attempt.score && quiz.max_points ? Math.round((attempt.score / quiz.max_points) * 100) : null,
      submittedAt: attempt.submitted_at,
      gradedAt: attempt.graded_at,
      attemptNumber: attempt.attempt_number,
      timeSpentMinutes: attempt.time_spent_minutes,
      feedback: attempt.feedback,
      hasQuizData: !!attempt.quiz_data
    }));

    res.json(createSuccessResponse({
      attempts: formattedAttempts,
      count: formattedAttempts.length,
      quiz: {
        id: quiz.id,
        title: quiz.title,
        maxPoints: quiz.max_points
      }
    }));

  } catch (error) {
    console.error('Get quiz attempts error:', error);
    res.status(500).json(createErrorResponse('Failed to fetch quiz attempts'));
  }
};


// Simple and direct approach: Get courses -> assessments -> marks
export const getStudentAssessmentData = async (req, res) => {
  try {
    const studentId = req.user.id;

    console.log(`Fetching assessment data for student: ${studentId}`);

    // STEP 1: Get all courses the user is enrolled in
    const { data: enrollments, error: enrollmentError } = await supabase
      .from('course_enrollments')
      .select(`
        course_id,
        enrolled_at,
        status,
        final_score,
        grade,
        courses (
          id,
          title,
          code,
          description,
          instructor_id,
          users!courses_instructor_id_fkey (
            first_name,
            last_name,
            email
          )
        )
      `)
      .eq('student_id', studentId)
      .eq('status', 'active');

    if (enrollmentError) {
      console.error('Error fetching enrollments:', enrollmentError);
      return res.status(500).json(createErrorResponse('Failed to fetch enrollments'));
    }

    if (!enrollments || enrollments.length === 0) {
      return res.json(createSuccessResponse({
        courses: [],
        totalCourses: 0
      }, 'No enrolled courses found'));
    }

    const results = [];

    // Process each course
    for (const enrollment of enrollments) {
      const course = enrollment.courses;
      
      console.log(`Processing course: ${course.title} (${course.id})`);

      // STEP 2: Get all assessments for this course
      const { data: assessments, error: assessmentError } = await supabase
        .from('assignments')
        .select(`
          id,
          title,
          description,
          assignment_type,
          max_points,
          due_date,
          is_published,
          created_at
        `)
        .eq('course_id', course.id)
        .eq('is_published', true)
        .order('due_date', { ascending: true });

      if (assessmentError) {
        console.error(`Error fetching assessments for course ${course.id}:`, assessmentError);
        continue; // Skip this course and continue with others
      }

      const assessmentsWithMarks = [];

      if (assessments && assessments.length > 0) {
        // STEP 3: For each assessment, get all the student's marks/submissions
        for (const assessment of assessments) {
          console.log(`Processing assessment: ${assessment.title} (${assessment.id})`);

          const { data: submissions, error: submissionError } = await supabase
            .from('assignment_submissions')
            .select(`
              id,
              status,
              score,
              submitted_at,
              graded_at,
              attempt_number,
              feedback
            `)
            .eq('assignment_id', assessment.id)
            .eq('student_id', studentId)
            .order('attempt_number', { ascending: false });

          if (submissionError) {
            console.error(`Error fetching submissions for assessment ${assessment.id}:`, submissionError);
            // Continue with empty submissions array
          }

          // Calculate best score and latest attempt
          let bestScore = null;
          let latestSubmission = null;
          let totalAttempts = submissions?.length || 0;

          if (submissions && submissions.length > 0) {
            // Get latest submission (first in ordered list)
            latestSubmission = submissions[0];
            
            // Find best score among all attempts
            const gradedSubmissions = submissions.filter(sub => 
              sub.status === 'graded' && sub.score !== null
            );
            
            if (gradedSubmissions.length > 0) {
              bestScore = Math.max(...gradedSubmissions.map(sub => sub.score));
            }
          }

          // Calculate percentage if we have a score and max points
          const percentage = (bestScore !== null && assessment.max_points > 0) 
            ? Math.round((bestScore / assessment.max_points) * 100) 
            : null;

          assessmentsWithMarks.push({
            assessment: {
              id: assessment.id,
              title: assessment.title,
              description: assessment.description,
              type: assessment.assignment_type,
              maxPoints: assessment.max_points,
              dueDate: assessment.due_date,
              createdAt: assessment.created_at
            },
            marks: {
              bestScore: bestScore,
              latestScore: latestSubmission?.score || null,
              percentage: percentage,
              totalAttempts: totalAttempts,
              status: latestSubmission?.status || 'not_submitted',
              lastSubmittedAt: latestSubmission?.submitted_at || null,
              lastGradedAt: latestSubmission?.graded_at || null,
              feedback: latestSubmission?.feedback || null
            },
            allAttempts: submissions || []
          });
        }
      }

      // Add course with its assessments and marks
      results.push({
        course: {
          id: course.id,
          title: course.title,
          code: course.code,
          description: course.description,
          instructor: {
            name: course.users ? `${course.users.first_name} ${course.users.last_name}`.trim() : 'TBD',
            email: course.users?.email || ''
          },
          enrolledAt: enrollment.enrolled_at,
          enrollmentStatus: enrollment.status,
          finalScore: enrollment.final_score,
          grade: enrollment.grade
        },
        assessments: assessmentsWithMarks,
        summary: {
          totalAssessments: assessmentsWithMarks.length,
          completedAssessments: assessmentsWithMarks.filter(a => a.marks.status === 'graded').length,
          pendingAssessments: assessmentsWithMarks.filter(a => a.marks.status === 'submitted').length,
          notSubmittedAssessments: assessmentsWithMarks.filter(a => a.marks.status === 'not_submitted').length,
          averageScore: assessmentsWithMarks.length > 0 ? 
            Math.round(
              assessmentsWithMarks
                .filter(a => a.marks.percentage !== null)
                .reduce((sum, a) => sum + a.marks.percentage, 0) / 
              assessmentsWithMarks.filter(a => a.marks.percentage !== null).length || 1
            ) : 0
        }
      });
    }

    // Calculate overall statistics
    const overallStats = {
      totalCourses: results.length,
      totalAssessments: results.reduce((sum, course) => sum + course.assessments.length, 0),
      totalCompletedAssessments: results.reduce((sum, course) => 
        sum + course.summary.completedAssessments, 0),
      overallAverage: results.length > 0 ? 
        Math.round(
          results.reduce((sum, course) => sum + course.summary.averageScore, 0) / results.length
        ) : 0
    };

    console.log(`Successfully processed ${results.length} courses with ${overallStats.totalAssessments} total assessments`);

    res.json(createSuccessResponse({
      courses: results,
      overallStats: overallStats,
      timestamp: new Date().toISOString()
    }, 'Assessment data retrieved successfully'));

  } catch (error) {
    console.error('Error in getStudentAssessmentData:', error);
    res.status(500).json(createErrorResponse('Failed to fetch student assessment data'));
  }
};



export const getFullTeacherAssessmentData = async (req, res) => {
  try {
    const teacherId = req.user.id;

    console.log(`Fetching full assessment data for teacher: ${teacherId}`);

    // 1. Get courses the teacher is teaching
    const { data: courses, error: courseError } = await supabase
      .from('courses')
      .select(`
        id,
        title,
        code,
        subject,
        description,
        credits
      `)
      .eq('instructor_id', teacherId);

    if (courseError) {
      console.error('Error fetching teacher courses:', courseError);
      return res.status(500).json(createErrorResponse('Failed to fetch courses'));
    }

    const results = [];

    for (const course of courses) {
      // 2. Get assignments for each course
      const { data: assignments, error: assignmentError } = await supabase
        .from('assignments')
        .select(`
          id,
          title,
          assignment_type,
          max_points,
          due_date
        `)
        .eq('course_id', course.id)
        .eq('is_published', true);

      if (assignmentError) {
        console.error(`Error fetching assignments for course ${course.id}:`, assignmentError);
        continue;
      }

      const assessments = [];

      for (const assignment of assignments) {
        // 3. Get all submissions for each assignment
        const { data: submissions, error: submissionError } = await supabase
          .from('assignment_submissions')
          .select(`
            id,
            student_id,
            score,
            submitted_at,
            graded_at,
            attempt_number,
            feedback,
            users (
              first_name,
              last_name,
              email
            )
          `)
          .eq('assignment_id', assignment.id)
          .order('attempt_number', { ascending: false });

        if (submissionError) {
          console.error(`Error fetching submissions for assignment ${assignment.id}:`, submissionError);
          continue;
        }

        // Group by student to get only latest attempts
        const studentMap = {};
        for (const sub of submissions) {
          if (!studentMap[sub.student_id]) {
            studentMap[sub.student_id] = sub;
          }
        }

        assessments.push({
          assignment: {
            id: assignment.id,
            title: assignment.title,
            type: assignment.assignment_type,
            maxPoints: assignment.max_points,
            dueDate: assignment.due_date
          },
          studentSubmissions: Object.values(studentMap).map(sub => ({
            student: {
              id: sub.student_id,
              name: `${sub.users?.first_name || ''} ${sub.users?.last_name || ''}`.trim(),
              email: sub.users?.email
            },
            submission: {
              score: sub.score,
              submittedAt: sub.submitted_at,
              gradedAt: sub.graded_at,
              feedback: sub.feedback,
              attemptNumber: sub.attempt_number
            }
          }))
        });
      }

      results.push({
        course: {
          id: course.id,
          title: course.title,
          code: course.code,
          subject: course.subject,
          credits: course.credits
        },
        assessments
      });
    }

    res.json(createSuccessResponse({
      courses: results,
      totalCourses: results.length,
      lastUpdated: new Date().toISOString()
    }, 'Teacher assessment data retrieved successfully'));

  } catch (error) {
    console.error('Error in getFullTeacherAssessmentData:', error);
    res.status(500).json(createErrorResponse('Failed to fetch teacher assessment data'));
  }
};

// Helper function to calculate letter grade
const calculateLetterGrade = (percentage) => {
  if (percentage >= 97) return 'A+';
  if (percentage >= 93) return 'A';
  if (percentage >= 90) return 'A-';
  if (percentage >= 87) return 'B+';
  if (percentage >= 83) return 'B';
  if (percentage >= 80) return 'B-';
  if (percentage >= 77) return 'C+';
  if (percentage >= 73) return 'C';
  if (percentage >= 70) return 'C-';
  if (percentage >= 67) return 'D+';
  if (percentage >= 63) return 'D';
  if (percentage >= 60) return 'D-';
  return 'F';
};

export const getTeacherAssessmentData = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const { assessmentId } = req.params;

    console.log(`Fetching assessment data for teacher: ${teacherId}, assessment: ${assessmentId}`);

    // 1. Verify the teacher has access to this assessment
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select(`
        id,
        title,
        description,
        assignment_type,
        max_points,
        due_date,
        available_from,
        available_until,
        is_published,
        allowed_attempts,
        has_time_limit,
        time_limit_minutes,
        created_at,
        course_id,
        courses!inner (
          id,
          title,
          code,
          description,
          instructor_id,
          teaching_assignments!inner (
            teacher_id
          )
        )
      `)
      .eq('id', assessmentId)
      .eq('courses.teaching_assignments.teacher_id', teacherId)
      .single();

    if (assignmentError || !assignment) {
      console.error('Error fetching assignment or unauthorized access:', assignmentError);
      return res.status(404).json(createErrorResponse('Assignment not found or access denied'));
    }

    const course = assignment.courses;

    // 2. Get all enrolled students in the course
    const { data: enrollments, error: enrollmentError } = await supabase
      .from('course_enrollments')
      .select(`
        student_id,
        enrolled_at,
        status,
        final_score,
        grade,
        users!inner (
          id,
          first_name,
          last_name,
          email,
          avatar_url
        )
      `)
      .eq('course_id', course.id)
      .eq('status', 'active')
      .order('users.last_name', { ascending: true });

    if (enrollmentError) {
      console.error('Error fetching enrollments:', enrollmentError);
      return res.status(500).json(createErrorResponse('Failed to fetch student enrollment data'));
    }

    if (!enrollments || enrollments.length === 0) {
      return res.json(createSuccessResponse({
        assignment: {
          id: assignment.id,
          title: assignment.title,
          description: assignment.description,
          type: assignment.assignment_type,
          maxPoints: assignment.max_points,
          dueDate: assignment.due_date,
          availableFrom: assignment.available_from,
          availableUntil: assignment.available_until,
          isPublished: assignment.is_published,
          allowedAttempts: assignment.allowed_attempts,
          hasTimeLimit: assignment.has_time_limit,
          timeLimitMinutes: assignment.time_limit_minutes,
          createdAt: assignment.created_at
        },
        course: {
          id: course.id,
          title: course.title,
          code: course.code,
          description: course.description
        },
        students: [],
        submissions: [],
        statistics: {
          totalStudents: 0,
          submittedCount: 0,
          gradedCount: 0,
          pendingCount: 0,
          notStartedCount: 0,
          averageScore: 0,
          highestScore: 0,
          lowestScore: 0,
          submissionRate: 0
        }
      }, 'No enrolled students found'));
    }

    // 3. Get all submissions for this assignment from enrolled students
    const studentIds = enrollments.map(e => e.student_id);
    
    const { data: submissions, error: submissionError } = await supabase
      .from('assignment_submissions')
      .select(`
        id,
        assignment_id,
        student_id,
        status,
        score,
        submitted_at,
        graded_at,
        attempt_number,
        feedback,
        time_started,
        time_completed,
        auto_submitted,
        quiz_data,
        content,
        file_url,
        EXTRACT(EPOCH FROM (time_completed - time_started))/60 as time_spent_minutes
      `)
      .eq('assignment_id', assessmentId)
      .in('student_id', studentIds)
      .order('student_id')
      .order('attempt_number', { ascending: false });

    if (submissionError) {
      console.error('Error fetching submissions:', submissionError);
      return res.status(500).json(createErrorResponse('Failed to fetch submission data'));
    }

    // 4. Create a map of best/latest submissions per student
    const submissionMap = {};
    const allSubmissionsMap = {};
    
    submissions?.forEach(sub => {
      // Track all submissions
      if (!allSubmissionsMap[sub.student_id]) {
        allSubmissionsMap[sub.student_id] = [];
      }
      allSubmissionsMap[sub.student_id].push(sub);

      // Track best submission (highest score, or latest if no score)
      if (!submissionMap[sub.student_id]) {
        submissionMap[sub.student_id] = sub;
      } else {
        const existing = submissionMap[sub.student_id];
        // Prioritize graded submissions, then highest score, then most recent
        if (sub.status === 'graded' && existing.status !== 'graded') {
          submissionMap[sub.student_id] = sub;
        } else if (sub.status === existing.status) {
          if (sub.score !== null && existing.score !== null) {
            if (sub.score > existing.score) {
              submissionMap[sub.student_id] = sub;
            }
          } else if (sub.score !== null && existing.score === null) {
            submissionMap[sub.student_id] = sub;
          } else if (new Date(sub.submitted_at) > new Date(existing.submitted_at)) {
            submissionMap[sub.student_id] = sub;
          }
        }
      }
    });

    // 5. Process student data with their submission information
    const studentData = [];
    const scores = [];
    let submittedCount = 0;
    let gradedCount = 0;
    let pendingCount = 0;
    let notStartedCount = 0;

    const now = new Date();
    const dueDate = assignment.due_date ? new Date(assignment.due_date) : null;

    enrollments.forEach(enrollment => {
      const student = enrollment.users;
      const bestSubmission = submissionMap[student.id];
      const allAttempts = allSubmissionsMap[student.id] || [];
      
      // Determine student status for this assignment
      let status = 'not_started';
      let percentage = null;
      let earnedPoints = null;

      if (bestSubmission) {
        if (bestSubmission.status === 'graded') {
          status = 'graded';
          gradedCount++;
        } else if (bestSubmission.status === 'submitted') {
          status = 'submitted';
          submittedCount++;
        } else {
          status = 'pending';
          pendingCount++;
        }

        if (bestSubmission.score !== null && bestSubmission.score !== undefined) {
          earnedPoints = bestSubmission.score;
          percentage = assignment.max_points > 0 ? 
            Math.round((bestSubmission.score / assignment.max_points) * 100) : 0;
          scores.push(bestSubmission.score);
        }
      } else {
        // Check if assignment is overdue
        if (dueDate && dueDate < now) {
          status = 'missing';
        }
        notStartedCount++;
      }

      studentData.push({
        student: {
          id: student.id,
          name: `${student.first_name} ${student.last_name}`.trim() || 'Unknown',
          firstName: student.first_name,
          lastName: student.last_name,
          email: student.email,
          avatarUrl: student.avatar_url,
          enrolledAt: enrollment.enrolled_at,
          enrollmentStatus: enrollment.status
        },
        submission: bestSubmission ? {
          id: bestSubmission.id,
          status: bestSubmission.status,
          score: bestSubmission.score,
          percentage: percentage,
          submittedAt: bestSubmission.submitted_at,
          gradedAt: bestSubmission.graded_at,
          attemptNumber: bestSubmission.attempt_number,
          totalAttempts: allAttempts.length,
          timeSpentMinutes: bestSubmission.time_spent_minutes,
          feedback: bestSubmission.feedback,
          content: bestSubmission.content,
          fileUrl: bestSubmission.file_url,
          autoSubmitted: bestSubmission.auto_submitted,
          quizData: bestSubmission.quiz_data
        } : null,
        allAttempts: allAttempts.map(attempt => ({
          id: attempt.id,
          attemptNumber: attempt.attempt_number,
          status: attempt.status,
          score: attempt.score,
          percentage: attempt.score && assignment.max_points > 0 ? 
            Math.round((attempt.score / assignment.max_points) * 100) : null,
          submittedAt: attempt.submitted_at,
          gradedAt: attempt.graded_at,
          timeSpentMinutes: attempt.time_spent_minutes,
          feedback: attempt.feedback
        })),
        assignmentStatus: status,
        performanceLevel: percentage !== null ? getPerformanceLevel(percentage) : 'not_attempted'
      });
    });

    // 6. Calculate statistics
    const totalStudents = enrollments.length;
    const submissionRate = totalStudents > 0 ? 
      Math.round(((submittedCount + gradedCount) / totalStudents) * 100) : 0;
    
    const averageScore = scores.length > 0 ? 
      Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
    
    const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
    const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;

    // 7. Grade distribution
    const gradeDistribution = {
      'A': 0, 'B': 0, 'C': 0, 'D': 0, 'F': 0
    };

    scores.forEach(score => {
      const percentage = assignment.max_points > 0 ? (score / assignment.max_points) * 100 : 0;
      const letterGrade = calculateLetterGrade(percentage);
      if (gradeDistribution.hasOwnProperty(letterGrade)) {
        gradeDistribution[letterGrade]++;
      }
    });

    console.log(`Found ${totalStudents} students with ${submissions?.length || 0} total submissions for assignment ${assessmentId}`);

    res.json(createSuccessResponse({
      assignment: {
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        type: assignment.assignment_type,
        maxPoints: assignment.max_points,
        dueDate: assignment.due_date,
        availableFrom: assignment.available_from,
        availableUntil: assignment.available_until,
        isPublished: assignment.is_published,
        allowedAttempts: assignment.allowed_attempts,
        hasTimeLimit: assignment.has_time_limit,
        timeLimitMinutes: assignment.time_limit_minutes,
        createdAt: assignment.created_at
      },
      course: {
        id: course.id,
        title: course.title,
        code: course.code,
        description: course.description
      },
      students: studentData,
      statistics: {
        totalStudents,
        submittedCount,
        gradedCount,
        pendingCount,
        notStartedCount,
        averageScore,
        averagePercentage: assignment.max_points > 0 ? 
          Math.round((averageScore / assignment.max_points) * 100) : 0,
        highestScore,
        lowestScore,
        submissionRate,
        gradeDistribution,
        totalSubmissions: submissions?.length || 0
      },
      lastUpdated: new Date().toISOString()
    }, 'Teacher assessment data retrieved successfully'));

  } catch (error) {
    console.error('Error in getTeacherAssessmentData:', error);
    res.status(500).json(createErrorResponse('Failed to fetch teacher assessment data'));
  }
};

/**
 * Get all courses and their assessments data for a teacher (overview page)
 */
export const getTeacherOverviewData = async (req, res) => {
  try {
    const teacherId = req.user.id;

    console.log(`Fetching teacher overview data for: ${teacherId}`);

    // 1. Get all courses taught by this teacher
    const { data: teachingAssignments, error: teachingError } = await supabase
      .from('teaching_assignments')
      .select(`
        course_id,
        role,
        assigned_at,
        courses!inner (
          id,
          title,
          code,
          description,
          subject,
          credits,
          created_at,
          is_active
        )
      `)
      .eq('teacher_id', teacherId)
      .eq('courses.is_active', true)
      .order('assigned_at', { ascending: false });

    if (teachingError) {
      console.error('Error fetching teaching assignments:', teachingError);
      return res.status(500).json(createErrorResponse('Failed to fetch course assignments'));
    }

    if (!teachingAssignments || teachingAssignments.length === 0) {
      return res.json(createSuccessResponse({
        courses: [],
        overallStats: {
          totalCourses: 0,
          totalStudents: 0,
          totalAssessments: 0,
          overallAverageScore: 0
        }
      }, 'No courses assigned'));
    }

    const results = [];
    let overallStats = {
      totalCourses: 0,
      totalStudents: 0,
      totalAssessments: 0,
      totalSubmissions: 0,
      totalGradedSubmissions: 0,
      totalPoints: 0,
      earnedPoints: 0
    };

    for (const assignment of teachingAssignments) {
      const course = assignment.courses;

      // 2. Get student enrollment count
      const { count: enrollmentCount, error: enrollmentCountError } = await supabase
        .from('course_enrollments')
        .select('*', { count: 'exact', head: true })
        .eq('course_id', course.id)
        .eq('status', 'active');

      if (enrollmentCountError) {
        console.error('Error fetching enrollment count:', enrollmentCountError);
        continue;
      }

      // 3. Get all assessments for the course
      const { data: assessments, error: assessmentError } = await supabase
        .from('assignments')
        .select(`
          id,
          title,
          description,
          assignment_type,
          max_points,
          due_date,
          is_published,
          created_at
        `)
        .eq('course_id', course.id)
        .eq('is_published', true)
        .order('due_date', { ascending: true });

      if (assessmentError) {
        console.error('Error fetching assessments:', assessmentError);
        continue;
      }

      // 4. Get submission statistics for all assessments in this course
      let courseStats = {
        totalAssessments: assessments?.length || 0,
        totalSubmissions: 0,
        gradedSubmissions: 0,
        averageScore: 0,
        totalPoints: 0,
        earnedPoints: 0
      };

      if (assessments && assessments.length > 0) {
        const assessmentIds = assessments.map(a => a.id);

        // Get all submissions for these assessments
        const { data: submissions, error: submissionError } = await supabase
          .from('assignment_submissions')
          .select(`
            assignment_id,
            student_id,
            status,
            score,
            attempt_number
          `)
          .in('assignment_id', assessmentIds)
          .order('student_id')
          .order('attempt_number', { ascending: false });

        if (!submissionError && submissions) {
          // Calculate points and create best submission map
          const bestSubmissions = {};
          submissions.forEach(sub => {
            if (!bestSubmissions[`${sub.student_id}-${sub.assignment_id}`]) {
              bestSubmissions[`${sub.student_id}-${sub.assignment_id}`] = sub;
            } else {
              const existing = bestSubmissions[`${sub.student_id}-${sub.assignment_id}`];
              if (sub.score > existing.score || 
                  (sub.score === existing.score && sub.status === 'graded' && existing.status !== 'graded')) {
                bestSubmissions[`${sub.student_id}-${sub.assignment_id}`] = sub;
              }
            }
          });

          // Calculate course statistics
          assessments.forEach(assessment => {
            courseStats.totalPoints += assessment.max_points || 0;
          });

          Object.values(bestSubmissions).forEach(submission => {
            courseStats.totalSubmissions++;
            if (submission.status === 'graded') {
              courseStats.gradedSubmissions++;
            }
            if (submission.score !== null) {
              courseStats.earnedPoints += submission.score;
            }
          });
        }
      }

      // Calculate averages
      const averageScore = courseStats.totalPoints > 0 ? 
        Math.round((courseStats.earnedPoints / courseStats.totalPoints) * 100) : 0;
      
      const completionRate = (enrollmentCount || 0) > 0 && courseStats.totalAssessments > 0 ? 
        Math.round((courseStats.totalSubmissions / ((enrollmentCount || 0) * courseStats.totalAssessments)) * 100) : 0;

      // Add to overall stats
      overallStats.totalCourses++;
      overallStats.totalStudents += enrollmentCount || 0;
      overallStats.totalAssessments += courseStats.totalAssessments;
      overallStats.totalSubmissions += courseStats.totalSubmissions;
      overallStats.totalGradedSubmissions += courseStats.gradedSubmissions;
      overallStats.totalPoints += courseStats.totalPoints;
      overallStats.earnedPoints += courseStats.earnedPoints;

      results.push({
        course: {
          id: course.id,
          title: course.title,
          code: course.code,
          description: course.description,
          subject: course.subject,
          credits: course.credits,
          createdAt: course.created_at
        },
        students: [], // We'll populate this when viewing course details
        assessments: assessments?.map(assessment => ({
          assessment: {
            id: assessment.id,
            title: assessment.title,
            description: assessment.description,
            type: assessment.assignment_type,
            maxPoints: assessment.max_points,
            dueDate: assessment.due_date,
            createdAt: assessment.created_at
          },
          studentMarks: [] // This will be populated in the detailed view
        })) || [],
        summary: {
          totalStudents: enrollmentCount || 0,
          totalAssessments: courseStats.totalAssessments,
          averageCompletionRate: completionRate,
          averageScore: averageScore
        }
      });
    }

    // Calculate overall average
    const overallAverageScore = overallStats.totalPoints > 0 ? 
      Math.round((overallStats.earnedPoints / overallStats.totalPoints) * 100) : 0;

    console.log(`Found ${results.length} courses for teacher ${teacherId}`);

    res.json(createSuccessResponse({
      courses: results,
      overallStats: {
        totalCourses: overallStats.totalCourses,
        totalStudents: overallStats.totalStudents,
        totalAssessments: overallStats.totalAssessments,
        totalCompletedAssessments: overallStats.totalGradedSubmissions,
        overallAverageScore: overallAverageScore
      },
      timestamp: new Date().toISOString()
    }, 'Teacher overview data retrieved successfully'));

  } catch (error) {
    console.error('Error in getTeacherOverviewData:', error);
    res.status(500).json(createErrorResponse('Failed to fetch teacher overview data'));
  }
};

// Helper function to determine performance level
const getPerformanceLevel = (percentage) => {
  if (percentage >= 90) return 'excellent';
  if (percentage >= 80) return 'good';
  if (percentage >= 70) return 'average';
  return 'needs_attention';
};




export default {
  getEnrolledCourses,
  getCourseQuizzes,
  getQuizDetails,
  getQuizAttempts,
  getFullStudentAssessmentData,
  getStudentAssessmentData,  // Add this line
  getFullTeacherAssessmentData,
  getTeacherAssessmentData
};

