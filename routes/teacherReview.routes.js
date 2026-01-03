// routes/teacherReview.routes.js
import express from 'express';
import { body, param, query } from 'express-validator';
import supabase from '../config/postgres.js';
import { 
  authenticateUser, 
  requireRole 
} from '../middleware/auth.middleware.js';
import {
  getAssessmentReview,
  getStudentSubmissionReview,
  gradeSubmission,
  getAssessmentStatistics,
  exportAssessmentResults
} from '../controllers/teacherReview.controller.js';

const router = express.Router();

// Apply authentication and teacher/admin role requirement to all routes
router.use(authenticateUser);
router.use(requireRole(['teacher', 'admin']));

// Validation rules
const assessmentIdValidation = [
  param('assessmentId')
    .isUUID()
    .withMessage('Assessment ID must be a valid UUID')
];

const studentIdValidation = [
  param('studentId')
    .isUUID()
    .withMessage('Student ID must be a valid UUID')
];

const gradeSubmissionValidation = [
  body('studentId')
    .isUUID()
    .withMessage('Student ID must be a valid UUID'),
  body('score')
    .isNumeric()
    .withMessage('Score must be a number')
    .isFloat({ min: 0 })
    .withMessage('Score must be 0 or greater'),
  body('feedback')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Feedback must be less than 2000 characters')
];

// Routes

/**
 * @route   GET /api/teacher-review/health
 * @desc    Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Teacher Review API is healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});


/**
 * GET /api/assignments/:assignmentId/scores
 * Fetches only essential submission data (scores, status) for an assignment
 * Excludes heavy fields like quiz_data, content, feedback, and file_url
 */
router.get('/assignments/:assignmentId/scores', async (req, res) => {
  try {
    const { assignmentId } = req.params;

    // Get assignment details with course info
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select(`
        id,
        title,
        description,
        max_points,
        due_date,
        assignment_type,
        courses!inner(
          id,
          title,
          code
        )
      `)
      .eq('id', assignmentId)
      .single();

    if (assignmentError || !assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    // Get all enrolled students in the course
    const { data: enrollments, error: enrollmentError } = await supabase
      .from('course_enrollments')
      .select(`
        student_id,
        users!course_enrollments_student_id_fkey(
          id,
          first_name,
          last_name,
          email,
          avatar_url
        )
      `)
      .eq('course_id', assignment.courses.id)
      .eq('status', 'active');

    if (enrollmentError) {
      return res.status(500).json({ error: enrollmentError.message });
    }

    // Get all submissions for this assignment
    const { data: submissions, error: submissionsError } = await supabase
      .from('assignment_submissions')
      .select(`
        id,
        student_id,
        submitted_at,
        status,
        score,
        attempt_number,
        time_started,
        time_completed,
        auto_submitted,
        graded_at,
        graded_by
      `)
      .eq('assignment_id', assignmentId);

    if (submissionsError) {
      return res.status(500).json({ error: submissionsError.message });
    }

    // Create a map of submissions by student_id
    const submissionMap = new Map();
    submissions?.forEach(sub => {
      if (!submissionMap.has(sub.student_id) || 
          new Date(sub.submitted_at) > new Date(submissionMap.get(sub.student_id).submitted_at)) {
        submissionMap.set(sub.student_id, sub);
      }
    });

    // Use assignment max_points as total possible points
    const totalPossiblePoints = assignment.max_points || 100;

    // Helper function to calculate letter grade
    function calculateLetterGrade(percentage) {
      if (percentage >= 90) return 'A';
      if (percentage >= 80) return 'B';
      if (percentage >= 70) return 'C';
      if (percentage >= 60) return 'D';
      return 'F';
    }

    // Helper function to calculate performance level
    function calculatePerformanceLevel(percentage) {
      if (percentage >= 85) return 'excellent';
      if (percentage >= 75) return 'good';
      if (percentage >= 60) return 'satisfactory';
      return 'needs_attention';
    }

    // Build student reviews array
    const studentReviews = enrollments?.map(enrollment => {
      const student = enrollment.users;
      const submission = submissionMap.get(enrollment.student_id);
      
      const studentName = `${student?.first_name || ''} ${student?.last_name || ''}`.trim();
      const hasSubmitted = !!submission && ['submitted', 'graded', 'late'].includes(submission.status);
      
      let percentage = 0;
      let letterGrade = 'N/A';
      let performanceLevel = null;
      
      if (hasSubmitted && submission.score !== null && totalPossiblePoints > 0) {
        percentage = Math.round((submission.score / totalPossiblePoints) * 100);
        letterGrade = calculateLetterGrade(percentage);
        performanceLevel = calculatePerformanceLevel(percentage);
      }

      return {
        student: {
          id: enrollment.student_id,
          name: studentName || student?.email,
          email: student?.email || '',
          avatarUrl: student?.avatar_url || null
        },
        submission: hasSubmitted ? {
          id: submission.id,
          submittedAt: submission.submitted_at,
          status: submission.status,
          score: submission.score || 0,
          percentage: percentage,
          letterGrade: letterGrade,
          performanceLevel: performanceLevel,
          attemptNumber: submission.attempt_number || 1,
          timeStarted: submission.time_started,
          timeCompleted: submission.time_completed,
          autoSubmitted: submission.auto_submitted || false,
          gradedAt: submission.graded_at,
          gradedBy: submission.graded_by
        } : null,
        status: hasSubmitted ? 'submitted' : 'not_submitted'
      };
    }) || [];

    // Calculate statistics
    const submittedReviews = studentReviews.filter(r => r.submission);
    const gradedReviews = submittedReviews.filter(r => r.submission?.status === 'graded');
    
    const totalScore = submittedReviews.reduce((sum, r) => sum + (r.submission?.score || 0), 0);
    const averageScore = submittedReviews.length > 0 ? Math.round(totalScore / submittedReviews.length) : 0;
    
    const totalPercentage = submittedReviews.reduce((sum, r) => sum + (r.submission?.percentage || 0), 0);
    const averagePercentage = submittedReviews.length > 0 ? Math.round(totalPercentage / submittedReviews.length) : 0;

    return res.status(200).json({
      assignment: {
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        maxPoints: assignment.max_points,
        dueDate: assignment.due_date,
        assignmentType: assignment.assignment_type
      },
      course: {
        id: assignment.courses.id,
        title: assignment.courses.title,
        code: assignment.courses.code
      },
      statistics: {
        totalStudents: studentReviews.length,
        submittedCount: submittedReviews.length,
        notSubmittedCount: studentReviews.length - submittedReviews.length,
        gradedCount: gradedReviews.length,
        averageScore: averageScore,
        averagePercentage: averagePercentage,
        submissionRate: studentReviews.length > 0 
          ? Math.round((submittedReviews.length / studentReviews.length) * 100) 
          : 0
      },
      studentReviews: studentReviews
    });
  } catch (err) {
    console.error('Error fetching teacher review data:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});



/**
 * GET /api/teacher-review/:assignmentId/student/:studentId
 * Fetches detailed quiz review for a single student
 * Includes questions, student answers, and grading information
 */
router.get('/assignments/:assignmentId/student/:studentId', async (req, res) => {
  try {
    const { assignmentId, studentId } = req.params;

    // Get assignment details
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select(`
        id,
        title,
        description,
        max_points,
        due_date,
        assignment_type,
        courses!inner(
          id,
          title,
          code
        )
      `)
      .eq('id', assignmentId)
      .single();

    if (assignmentError || !assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    // Get student information
    const { data: student, error: studentError } = await supabase
      .from('users')
      .select('id, first_name, last_name, email, avatar_url')
      .eq('id', studentId)
      .single();

    if (studentError || !student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Get quiz questions with their answers/options
    const { data: questions, error: questionsError } = await supabase
      .from('quiz_questions')
      .select(`
        id,
        question_number,
        title,
        question_text,
        question_type,
        points,
        short_answer_match_type,
        short_answer_case_sensitive
      `)
      .eq('assignment_id', assignmentId)
      .order('question_number', { ascending: true });

    if (questionsError) {
      return res.status(500).json({ error: questionsError.message });
    }

    // Get multiple choice answers for each question
    const { data: mcAnswers, error: mcAnswersError } = await supabase
      .from('quiz_question_answers')
      .select('id, question_id, answer_text, is_correct, feedback, answer_order')
      .in('question_id', questions?.map(q => q.id) || [])
      .order('answer_order', { ascending: true });

    if (mcAnswersError) {
      return res.status(500).json({ error: mcAnswersError.message });
    }

    // Get short answer options for each question
    const { data: shortAnswerOptions, error: shortAnswerError } = await supabase
      .from('quiz_short_answer_options')
      .select('id, question_id, answer_text, is_case_sensitive, is_exact_match, answer_order')
      .in('question_id', questions?.map(q => q.id) || [])
      .order('answer_order', { ascending: true });

    if (shortAnswerError) {
      return res.status(500).json({ error: shortAnswerError.message });
    }

    // Create maps for quick lookup
    const mcAnswersMap = new Map();
    mcAnswers?.forEach(answer => {
      if (!mcAnswersMap.has(answer.question_id)) {
        mcAnswersMap.set(answer.question_id, []);
      }
      mcAnswersMap.get(answer.question_id).push(answer);
    });

    const shortAnswerMap = new Map();
    shortAnswerOptions?.forEach(option => {
      if (!shortAnswerMap.has(option.question_id)) {
        shortAnswerMap.set(option.question_id, []);
      }
      shortAnswerMap.get(option.question_id).push(option);
    });

    // Get student's submission
    const { data: submission, error: submissionError } = await supabase
      .from('assignment_submissions')
      .select(`
        id,
        submitted_at,
        status,
        score,
        feedback,
        attempt_number,
        time_started,
        time_completed,
        auto_submitted,
        graded_at,
        graded_by,
        quiz_data
      `)
      .eq('assignment_id', assignmentId)
      .eq('student_id', studentId)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    if (submissionError && submissionError.code !== 'PGRST116') {
      return res.status(500).json({ error: submissionError.message });
    }

    // Format questions with their answers and student responses
    const formattedQuestions = questions?.map(question => {
      const questionData = {
        id: question.id,
        questionNumber: question.question_number,
        title: question.title,
        questionText: question.question_text,
        questionType: question.question_type,
        points: question.points,
        imageUrl: question.image_url
      };

      // Add multiple choice answers if applicable
      if (['multiple_choice', 'true_false'].includes(question.question_type)) {
        questionData.answers = mcAnswersMap.get(question.id) || [];
      }

      // Add short answer options if applicable
      if (question.question_type === 'short_answer') {
        questionData.shortAnswerOptions = shortAnswerMap.get(question.id) || [];
        questionData.matchType = question.short_answer_match_type;
        questionData.caseSensitive = question.short_answer_case_sensitive;
      }

      // Add student's answer from quiz_data
      if (submission?.quiz_data && submission.quiz_data[question.id]) {
        questionData.studentAnswer = submission.quiz_data[question.id];
      }

      return questionData;
    }) || [];

    // Calculate percentage if submission exists
    let percentage = 0;
    let letterGrade = 'N/A';
    let performanceLevel = null;

    if (submission && submission.score !== null && assignment.max_points > 0) {
      percentage = Math.round((submission.score / assignment.max_points) * 100);
      letterGrade = calculateLetterGrade(percentage);
      performanceLevel = calculatePerformanceLevel(percentage);
    }

    // Helper function to calculate letter grade
    function calculateLetterGrade(percentage) {
      if (percentage >= 90) return 'A';
      if (percentage >= 80) return 'B';
      if (percentage >= 70) return 'C';
      if (percentage >= 60) return 'D';
      return 'F';
    }

    // Helper function to calculate performance level
    function calculatePerformanceLevel(percentage) {
      if (percentage >= 85) return 'excellent';
      if (percentage >= 75) return 'good';
      if (percentage >= 60) return 'satisfactory';
      return 'needs_attention';
    }

    const studentName = `${student.first_name || ''} ${student.last_name || ''}`.trim();

    return res.status(200).json({
      assignment: {
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        maxPoints: assignment.max_points,
        dueDate: assignment.due_date,
        assignmentType: assignment.assignment_type
      },
      course: {
        id: assignment.courses.id,
        title: assignment.courses.title,
        code: assignment.courses.code
      },
      student: {
        id: student.id,
        name: studentName || student.email,
        email: student.email,
        avatarUrl: student.avatar_url
      },
      submission: submission ? {
        id: submission.id,
        submittedAt: submission.submitted_at,
        status: submission.status,
        score: submission.score || 0,
        percentage: percentage,
        letterGrade: letterGrade,
        performanceLevel: performanceLevel,
        feedback: submission.feedback,
        attemptNumber: submission.attempt_number || 1,
        timeStarted: submission.time_started,
        timeCompleted: submission.time_completed,
        autoSubmitted: submission.auto_submitted || false,
        gradedAt: submission.graded_at,
        gradedBy: submission.graded_by
      } : null,
      questions: formattedQuestions,
      hasSubmitted: !!submission
    });
  } catch (err) {
    console.error('Error fetching student review data:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @route   GET /api/teacher-review/:assessmentId
 * @desc    Get comprehensive assessment review
 */
router.get('/:assessmentId',
  assessmentIdValidation,
  getAssessmentReview
);

/**
 * @route   GET /api/teacher-review/:assessmentId/student/:studentId
 * @desc    Get detailed review for a specific student's submission
 */
router.get('/:assessmentId/student/:studentId',

  getStudentSubmissionReview
);

/**
 * @route   POST /api/teacher-review/:assessmentId/grade
 * @desc    Grade or update grade for a student's submission
 */
router.post('/:assessmentId/grade',
  assessmentIdValidation,
  gradeSubmissionValidation,
  gradeSubmission
);

/**
 * @route   GET /api/teacher-review/:assessmentId/statistics
 * @desc    Get comprehensive statistics for an assessment
 */
router.get('/:assessmentId/statistics',
  assessmentIdValidation,
  getAssessmentStatistics
);

/**
 * @route   GET /api/teacher-review/:assessmentId/export
 * @desc    Export assessment results
 */
router.get('/:assessmentId/export',
  assessmentIdValidation,
  [
    query('format')
      .optional()
      .isIn(['csv', 'json'])
      .withMessage('Export format must be either csv or json')
  ],
  exportAssessmentResults
);

export default router;