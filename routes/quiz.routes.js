// routes/quiz.routes.js - UPDATE THE IMPORT SECTION

import express from 'express';
import { body, param, query } from 'express-validator';
import {
  getEnrolledCourses,
  getCourseQuizzes,
  getQuizDetails,
  getQuizAttempts,
  getFullStudentAssessmentData,
  getStudentAssessmentData,
  getTeacherAssessmentData,
  saveQuestionGrade
} from '../controllers/quiz.controller.js';
import { authenticateToken, requireRole  } from '../middleware/auth.middleware.js';

const router = express.Router();

// Validation middleware
const validateCourseId = [
  param('courseId')
    .isUUID()
    .withMessage('Course ID must be a valid UUID')
];

const validateQuizId = [
  param('quizId')
    .isUUID()
    .withMessage('Quiz ID must be a valid UUID')
];

const validateStudentId = [
  query('studentId')
    .optional()
    .isUUID()
    .withMessage('Student ID must be a valid UUID')
];

/**
 * @route   GET /api/quiz/all-data
 * @desc    Get all courses, assessments, and marks for the authenticated student
 * @access  Private (Student only)
 */
router.get('/all-data',
  authenticateToken,
  getStudentAssessmentData
);

/**
 * @route   GET /api/quiz/courses
 * @desc    Get all courses the authenticated user is enrolled in (students) or teaching (teachers)
 * @access  Private (Student, Teacher, Admin)
 * @returns Array of courses with enrollment/teaching information and grade statistics
 */
router.get('/courses', 
  authenticateToken,
  getEnrolledCourses
);

/**
 * @route   GET /api/quiz/courses/:courseId/quizzes
 * @desc    Get all quizzes/assessments for a specific course
 * @access  Private (Student enrolled in course, Teacher of course, Admin)
 * @param   courseId - UUID of the course
 * @returns Array of quizzes/assessments with submission data (for students) or submission counts (for teachers)
 */
router.get('/courses/:courseId/quizzes',
  authenticateToken,
  validateCourseId,
  getCourseQuizzes
);

/**
 * @route   GET /api/quiz/:quizId
 * @desc    Get detailed information about a specific quiz/assessment
 * @access  Private (Student enrolled in course, Teacher of course, Admin)
 * @param   quizId - UUID of the quiz/assessment
 * @returns Detailed quiz information including questions (if available/authorized)
 */
router.get('/allowedTakeQuizz/:quizId',
  authenticateToken,
  validateQuizId,
  getQuizDetails
);




/**
 * @route   GET /api/quiz/:quizId/attempts
 * @desc    Get quiz attempt history
 * @access  Private
 * @param   quizId - UUID of the quiz
 * @param   studentId - Optional query param for teachers/admins to filter by specific student
 * @returns Array of quiz attempts with scores and timing information
 * @note    Students see only their own attempts, teachers/admins see all attempts (or filtered by studentId)
 */
router.get('/:quizId/attempts',
  authenticateToken,
  validateQuizId,
  validateStudentId,
  getQuizAttempts
);

/**
 * @route   GET /api/quiz/health
 * @desc    Health check endpoint
 * @access  Public
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Quiz API is healthy',
    timestamp: new Date().toISOString(),
  });
});

/**
 * @route   GET /api/quiz/full
 * @desc    Get enrolled courses, their quizzes, and the student's submissions (original version)
 * @access  Private (Student)
 */
router.get('/full',
  authenticateToken,
  getFullStudentAssessmentData
);


//update long assignment marks


/**
 * @route   GET /api/quiz/assessment/:assessmentId
 * @desc    Get detailed data for a specific assessment including all student submissions
 * @access  Private (Teacher)
 */
router.get('/assessment/:assessmentId',
  authenticateToken,
  requireRole(['teacher', 'admin']),
  getTeacherAssessmentData
);

/**
 * @route   PUT /api/quiz/submissions/:submissionId/questions/:questionId/grade
 * @desc    Save or update grade for a specific question in a student's submission
 * @access  Private (Teacher, Admin)
 * @param   submissionId - UUID of the assignment submission
 * @param   questionId - UUID of the question being graded
 * @body    points - Number of points awarded (required)
 * @returns Updated submission data with new grade
 * @example
 * PUT /api/quiz/submissions/123e4567-e89b-12d3-a456-426614174000/questions/987fcdeb-51a2-43d1-9f12-123456789abc/grade
 * Body: { "points": 8.5 }
 */
router.put('/submissions/:submissionId/questions/:questionId/grade',
  authenticateToken,
  requireRole(['teacher', 'admin']),
  saveQuestionGrade
);


export default router;