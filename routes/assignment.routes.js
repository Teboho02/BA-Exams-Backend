// routes/assignment.routes.js
import express from 'express';
import { body, param } from 'express-validator';
import { 
  authenticateUser, 
  requireRole 
} from '../middleware/auth.middleware.js';
import {
  createAssignment,
  getAssignmentsByCourse,
  getAssignment,
  updateAssignment,
  deleteAssignment,
  toggleAssignmentPublish,
  getUserSubmissions,
  verifyQuizPassword,
  submitQuizAnswers,
  getQuizResults
} from '../controllers/assignment.controller.js';

const router = express.Router();

// Validation rules
const createAssignmentValidation = [
  body('courseId')
    .isUUID()
    .withMessage('Valid course ID is required'),
  body('title')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Title is required and must be less than 255 characters'),
  body('description')
    .trim()
    .isLength({ min: 1 })
    .withMessage('Description is required'),
  body('assignmentType')
    .optional()
    .isIn(['assignment', 'quiz', 'discussion', 'external_tool'])
    .withMessage('Invalid assignment type'),
  body('gradingType')
    .optional()
    .isIn(['points', 'percent', 'letter_grade', 'gpa_scale', 'pass_fail'])
    .withMessage('Invalid grading type'),
  body('maxPoints')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('Max points must be between 1 and 1000'),
  body('submissionType')
    .optional()
    .isIn(['file', 'text', 'url', 'none', 'online_quiz'])
    .withMessage('Invalid submission type'),
  body('dueDate')
    .optional()
    .isISO8601()
    .withMessage('Due date must be a valid date'),
  body('availableFrom')
    .optional()
    .isISO8601()
    .withMessage('Available from date must be a valid date'),
  body('availableUntil')
    .optional()
    .isISO8601()
    .withMessage('Available until date must be a valid date'),
  body('allowedAttempts')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Allowed attempts must be between 1 and 100'),
  body('timeLimitMinutes')
    .optional()
    .isInt({ min: 1, max: 480 })
    .withMessage('Time limit must be between 1 and 480 minutes'),
  body('questions')
    .optional()
    .isArray()
    .withMessage('Questions must be an array'),
  body('questions.*.title')
    .optional()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Question title is required'),
  body('questions.*.questionText')
    .optional()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Question text is required'),
  body('questions.*.questionType')
    .optional()
    .isIn(['multiple_choice', 'true_false', 'short_answer', 'essay', 'file_upload'])
    .withMessage('Invalid question type'),
  body('questions.*.points')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Question points must be between 1 and 100')
];

const updateAssignmentValidation = [
  param('assignmentId')
    .isUUID()
    .withMessage('Valid assignment ID is required'),
  body('title')
    .optional()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Title must be less than 255 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Description cannot be empty'),
  body('assignmentType')
    .optional()
    .isIn(['assignment', 'quiz', 'discussion', 'external_tool'])
    .withMessage('Invalid assignment type'),
  body('gradingType')
    .optional()
    .isIn(['points', 'percent', 'letter_grade', 'gpa_scale', 'pass_fail'])
    .withMessage('Invalid grading type'),
  body('maxPoints')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('Max points must be between 1 and 1000'),
  body('submissionType')
    .optional()
    .isIn(['file', 'text', 'url', 'none', 'online_quiz'])
    .withMessage('Invalid submission type'),
  body('dueDate')
    .optional()
    .isISO8601()
    .withMessage('Due date must be a valid date'),
  body('availableFrom')
    .optional()
    .isISO8601()
    .withMessage('Available from date must be a valid date'),
  body('availableUntil')
    .optional()
    .isISO8601()
    .withMessage('Available until date must be a valid date'),
  body('allowedAttempts')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Allowed attempts must be between 1 and 100'),
  body('timeLimitMinutes')
    .optional()
    .isInt({ min: 1, max: 480 })
    .withMessage('Time limit must be between 1 and 480 minutes')
];

const assignmentIdValidation = [
  param('assignmentId')
    .isUUID()
    .withMessage('Valid assignment ID is required')
];

const courseIdValidation = [
  param('courseId')
    .isUUID()
    .withMessage('Valid course ID is required')
];

const publishValidation = [
  param('assignmentId')
    .isUUID()
    .withMessage('Valid assignment ID is required'),
  body('published')
    .isBoolean()
    .withMessage('Published status must be a boolean')
];

const passwordValidation = [
  param('assignmentId')
    .isUUID()
    .withMessage('Valid assignment ID is required'),
  body('password')
    .trim()
    .isLength({ min: 1 })
    .withMessage('Password is required')
];

const submitQuizValidation = [
  param('assignmentId')
    .isUUID()
    .withMessage('Valid assignment ID is required'),
  body('answers')
    .isObject()
    .withMessage('Answers must be an object'),
  body('timeStarted')
    .optional()
    .isISO8601()
    .withMessage('Time started must be a valid date'),
  body('timeCompleted')
    .optional()
    .isISO8601()
    .withMessage('Time completed must be a valid date')
];

const submissionIdValidation = [
  param('submissionId')
    .isUUID()
    .withMessage('Valid submission ID is required')
];


// Assignment routes

// Create new assignment (teachers and admins only)
router.post('/', 
  authenticateUser, 
  requireRole(['teacher', 'admin']), 
  createAssignmentValidation, 
  createAssignment
);

// Get all assignments for a course
router.get('/course/:courseId',
  authenticateUser, 
  courseIdValidation, 
  getAssignmentsByCourse
);

// Get single assignment with questions
router.get('/:assignmentId', 
  authenticateUser, 
  assignmentIdValidation, 
  getAssignment
);

// Update assignment (teachers and admins only)
router.put('/:assignmentId', 
  authenticateUser, 
  requireRole(['teacher', 'admin']), 
  updateAssignmentValidation, 
  updateAssignment
);

// Delete assignment (teachers and admins only)
router.delete('/:assignmentId', 
  authenticateUser, 
  requireRole(['teacher', 'admin']), 
  assignmentIdValidation, 
  deleteAssignment
);

// Publish/unpublish assignment (teachers and admins only)
router.patch('/:assignmentId/publish', 
  authenticateUser, 
  requireRole(['teacher', 'admin']), 
  publishValidation, 
  toggleAssignmentPublish
);

router.get('/:assignmentId/submissions', 
  authenticateUser, 
  assignmentIdValidation, 
  getUserSubmissions
);

// Verify quiz password
router.post('/:assignmentId/verify-password', 
  authenticateUser, 
  passwordValidation, 
  verifyQuizPassword
);

// Submit quiz answers
router.post('/:assignmentId/submit', 
  authenticateUser, 
  submitQuizValidation, 
  submitQuizAnswers
);

// Get quiz results
router.get('/submission/:submissionId/results', 
  authenticateUser, 
  submissionIdValidation, 
  getQuizResults
);


// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Assignment API is healthy',
    timestamp: new Date().toISOString()
  });
});

export default router;