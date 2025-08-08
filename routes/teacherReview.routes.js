// routes/teacherReview.routes.js
import express from 'express';
import { body, param, query } from 'express-validator';
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
  assessmentIdValidation,
  studentIdValidation,
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