import express from 'express';
import { body, param, query } from 'express-validator';
import {
  createCourse,
  getCourses,
  getCourse,
  updateCourse,
  deleteCourse,
  enrollStudent,
  unenrollStudent,
  addModule,
  getUserEnrolledCourses,
  getUserCourses,
  enrollStudentByEmail,
  handleValidationErrors
} from '../controllers/course.controller.js';
import { authenticateUser, requireRole } from '../middleware/auth.middleware.js';

const router = express.Router();

// Validation rules
const courseValidation = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ max: 255 })
    .withMessage('Title must be less than 255 characters'),
  
  body('code')
    .trim()
    .notEmpty()
    .withMessage('Course code is required')
    .isLength({ max: 50 })
    .withMessage('Course code must be less than 50 characters')
    .matches(/^[A-Z0-9-]+$/)
    .withMessage('Course code must contain only uppercase letters, numbers, and hyphens'),
  
  body('subject')
    .trim()
    .notEmpty()
    .withMessage('Subject is required')
    .isLength({ max: 100 })
    .withMessage('Subject must be less than 100 characters'),
  
  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description must be less than 2000 characters'),
  
  body('maxStudents')
    .optional()
    .isInt({ min: 1, max: 1500 })
    .withMessage('Max students must be between 1 and 1500'),
  
  body('credits')
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage('Credits must be between 1 and 10')
];

const updateCourseValidation = [
  body('title')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Title cannot be empty')
    .isLength({ max: 255 })
    .withMessage('Title must be less than 255 characters'),
  
  body('code')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Course code cannot be empty')
    .isLength({ max: 50 })
    .withMessage('Course code must be less than 50 characters')
    .matches(/^[A-Z0-9-]+$/)
    .withMessage('Course code must contain only uppercase letters, numbers, and hyphens'),
  
  body('subject')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Subject cannot be empty')
    .isLength({ max: 100 })
    .withMessage('Subject must be less than 100 characters'),
  
  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description must be less than 2000 characters')
];

const enrollmentValidation = [
  body('studentId')
    .notEmpty()
    .withMessage('Student ID is required')
    .isUUID()
    .withMessage('Student ID must be a valid UUID')
];

const moduleValidation = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Module title is required')
    .isLength({ max: 255 })
    .withMessage('Module title must be less than 255 characters'),
  
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Module description must be less than 1000 characters'),
  
  body('order')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Module order must be a positive integer'),
  
  body('content')
    .optional()
    .isArray()
    .withMessage('Module content must be an array'),
  
  body('isPublished')
    .optional()
    .isBoolean()
    .withMessage('isPublished must be a boolean')
];

const queryValidation = [
  query('subject')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Subject filter must be less than 100 characters'),
  
  query('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),
  
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
];

const paramValidation = [
  param('id')
    .isUUID()
    .withMessage('Course ID must be a valid UUID')
];

// Apply authentication to all routes
router.use(authenticateUser);

// Routes

/**
 * @route   POST /api/courses
 * @desc    Create a new course
 * @access  Private (Teachers only)
 */
router.post(
  '/',
  requireRole(['teacher', 'admin']),
  courseValidation,
  handleValidationErrors,
  createCourse
);

/**
 * @route   GET /api/courses
 * @desc    Get all courses (filtered by user role)
 * @access  Private
 * @query   subject, isActive, page, limit
 */
router.get(
  '/',
  queryValidation,
  handleValidationErrors,
  getCourses
);

/**
 * @route   GET /api/courses/:id
 * @desc    Get a specific course by ID
 * @access  Private
 */
router.get(
  '/:id',
  paramValidation,
  handleValidationErrors,
  getCourse
);

/**
 * @route   PUT /api/courses/:id
 * @desc    Update a course
 * @access  Private (Course instructor or admin only)
 */
router.put(
  '/:id',
  paramValidation,
  updateCourseValidation,
  handleValidationErrors,
  updateCourse
);

/**
 * @route   DELETE /api/courses/:id
 * @desc    Deactivate a course
 * @access  Private (Course instructor or admin only)
 */
router.delete(
  '/:id',
  paramValidation,
  handleValidationErrors,
  deleteCourse
);

/**
 * @route   POST /api/courses/:id/enroll
 * @desc    Enroll a student in a course
 * @access  Private (Students can enroll themselves, teachers can enroll students)
 */
router.post(
  '/:id/enroll',
  paramValidation,
  body('studentId').optional().isUUID().withMessage('Student ID must be a valid UUID'),
  handleValidationErrors,
  enrollStudent
);

/**
 * @route   DELETE /api/courses/:id/enroll/:studentId
 * @desc    Unenroll a student from a course
 * @access  Private (Students can unenroll themselves, teachers can unenroll students)
 */
router.delete(
  '/:id/enroll/:studentId',
  paramValidation,
  param('studentId').isUUID().withMessage('Student ID must be a valid UUID'),
  handleValidationErrors,
  unenrollStudent
); 


/**
 * @route   POST /api/courses/:id/enroll/email
 * @desc    Enroll a student in a course by email
 * @access  Private (Teachers and admins only)
 */
router.post(
  '/:id/enroll/email',
  requireRole(['teacher', 'admin']),
  param('id').isUUID().withMessage('Course ID must be a valid UUID'),
  body('email')
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail(),
  handleValidationErrors,
  enrollStudentByEmail
);

/**
 * @route   GET /api/courses/:id/students
 * @desc    Get all students enrolled in a course
 * @access  Private (Course instructor or admin only)
 */
router.get(
  '/:id/students',
  requireRole(['teacher', 'admin']),
  paramValidation,
  handleValidationErrors,
  async (req, res) => {
    try {
      const courseId = req.params.id;
      
      // Get enrolled students with their enrollment details
      const { data: enrollments, error } = await supabase
        .from('student_enrollments')
        .select('*')
        .eq('course_id', courseId)
        .order('enrolled_at', { ascending: false });

      if (error) throw error;

      res.json(createSuccessResponse({
        students: enrollments,
        count: enrollments.length
      }));
    } catch (error) {
      console.error('Get course students error:', error);
      res.status(500).json(createErrorResponse('Failed to fetch course students'));
    }
  }
);




/**
 * @route   PUT /api/courses/:id/students/:studentId/grade
 * @desc    Assign grade to a student
 * @access  Private (Course instructor or admin only)
 */
router.put(
  '/:id/students/:studentId/grade',
  requireRole(['teacher', 'admin']),
  paramValidation,
  param('studentId').isUUID().withMessage('Student ID must be a valid UUID'),
  body('grade').notEmpty().withMessage('Grade is required'),
  body('finalScore').optional().isFloat({ min: 0, max: 100 }).withMessage('Final score must be between 0 and 100'),
  body('notes').optional().isString(),
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id: courseId, studentId } = req.params;
      const { grade, finalScore, notes } = req.body;

      const { data, error } = await supabase
        .from('course_enrollments')
        .update({
          grade,
          final_score: finalScore,
          notes,
          grade_assigned_at: new Date().toISOString()
        })
        .eq('course_id', courseId)
        .eq('student_id', studentId)
        .select()
        .single();

      if (error) throw error;

      res.json(createSuccessResponse({
        enrollment: data
      }, 'Grade assigned successfully'));
    } catch (error) {
      console.error('Grade assignment error:', error);
      res.status(500).json(createErrorResponse('Failed to assign grade'));
    }
  }
);

/**
 * @route   POST /api/courses/:id/modules
 * @desc    Add a module to a course
 * @access  Private (Course instructor or admin only)
 */
router.post(
  '/:id/modules',
  requireRole(['teacher', 'admin']),
  paramValidation,
  moduleValidation,
  handleValidationErrors,
  addModule
);

// Additional useful routes you might want to add:

/**
 * @route   GET /api/courses/:id/students
 * @desc    Get all students enrolled in a course
 * @access  Private (Course instructor or admin only)
 */
router.get(
  '/:id/students',
  requireRole(['teacher', 'admin']),
  paramValidation,
  handleValidationErrors,
  async (req, res) => {
    // This would be implemented in your controller
    res.status(501).json({ message: 'Not implemented yet' });
  }
);

/**
 * @route   GET /api/courses/user/enrollments
 * @desc    Get all courses a user is enrolled in with enrollment details
 * @access  Private (Students only)
 * @query   status, subject
 */
router.get('/user/enrollments', 
  requireRole(['student']), 
  query('status')
    .optional()
    .isIn(['active', 'dropped', 'completed', 'suspended'])
    .withMessage('Status must be one of: active, dropped, completed, suspended'),
  query('subject')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Subject filter must be less than 100 characters'),
  handleValidationErrors,
  getUserEnrolledCourses
);

/**
 * @route   GET /api/courses/user/courses  
 * @desc    Get all courses a user is enrolled in (simplified version)
 * @access  Private (Students only)
 * @query   status, subject
 */
router.get('/user/courses',
  requireRole(['student']),
  query('status')
    .optional()
    .isIn(['active', 'dropped', 'completed', 'suspended'])
    .withMessage('Status must be one of: active, dropped, completed, suspended'),
  query('subject')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Subject filter must be less than 100 characters'),
  handleValidationErrors,
  getUserCourses
);
/**
 * @route   GET /api/courses/:id/modules
 * @desc    Get all modules for a course
 * @access  Private (Enrolled students, instructor, or admin)
 */
router.get(
  '/:id/modules',
  paramValidation,
  handleValidationErrors,
  async (req, res) => {
    // This would be implemented in your controller
    res.status(501).json({ message: 'Not implemented yet' });
  }
);

/**
 * @route   PUT /api/courses/:id/modules/:moduleId
 * @desc    Update a specific module
 * @access  Private (Course instructor or admin only)
 */
router.put(
  '/:id/modules/:moduleId',
  requireRole(['teacher', 'admin']),
  paramValidation,
  param('moduleId').isUUID().withMessage('Module ID must be a valid UUID'),
  moduleValidation,
  handleValidationErrors,
  async (req, res) => {
    // This would be implemented in your controller
    res.status(501).json({ message: 'Not implemented yet' });
  }
);

/**
 * @route   DELETE /api/courses/:id/modules/:moduleId
 * @desc    Delete a specific module
 * @access  Private (Course instructor or admin only)
 */
router.delete(
  '/:id/modules/:moduleId',
  requireRole(['teacher', 'admin']),
  paramValidation,
  param('moduleId').isUUID().withMessage('Module ID must be a valid UUID'),
  handleValidationErrors,
  async (req, res) => {
    // This would be implemented in your controller
    res.status(501).json({ message: 'Not implemented yet' });
  }
);

export default router;