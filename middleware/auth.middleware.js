// middleware/auth.middleware.js
import jwt from 'jsonwebtoken';
import supabase from '../config/postgres.js';

// Create error response helper
const createErrorResponse = (message, statusCode = 401) => ({
  success: false,
  message,
  statusCode
});

// Main authentication middleware

export const authenticateUser = async (req, res, next) => {
  try {

    console.log('=== Auth Debug ===');
    console.log('Cookies received:', req.cookies);
    console.log('Origin:', req.get('Origin'));
    console.log('Referer:', req.get('Referer'));
    console.log('All headers:', req.headers);

    let token;

    token = req.cookies.accessToken;


    if (!token) {
      return res.status(401).json(createErrorResponse('Access token required'));
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from Supabase
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.id)
      .eq('is_active', true)
      .single();

    if (error || !user) {
      return res.status(401).json(createErrorResponse('Invalid or expired token'));
    }

    // Attach user to request
    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    console.error('Authentication error:', error);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json(createErrorResponse('Invalid token'));
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json(createErrorResponse('Token expired'));
    }

    res.status(401).json(createErrorResponse('Authentication failed'));
  }
};

// Alternative name for backwards compatibility
export const authenticateToken = authenticateUser;

// Role-based authorization middleware
export const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json(createErrorResponse('Authentication required'));
    }

    const userRole = req.user.role;
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

    if (!roles.includes(userRole)) {
      return res.status(403).json(createErrorResponse(
        `Access denied. Required role(s): ${roles.join(', ')}. Your role: ${userRole}`,
        403
      ));
    }

    next();
  };
};

// Check if user can access a specific course
export const checkCourseAccess = async (req, res, next) => {
  try {
    const courseId = req.params.id || req.params.courseId || req.body.courseId;
    const user = req.user;

    if (!courseId) {
      return res.status(400).json(createErrorResponse('Course ID required', 400));
    }

    // Admins have access to all courses
    if (user.role === 'admin') {
      return next();
    }

    // Get course details
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('instructor_id')
      .eq('id', courseId)
      .single();

    if (courseError || !course) {
      return res.status(404).json(createErrorResponse('Course not found', 404));
    }

    // Teachers can access their own courses
    if (user.role === 'teacher' && course.instructor_id === user.id) {
      return next();
    }

    // Students can access courses they're enrolled in
    if (user.role === 'student') {
      const { data: enrollment, error: enrollmentError } = await supabase
        .from('course_enrollments')
        .select('id')
        .eq('course_id', courseId)
        .eq('student_id', user.id)
        .eq('status', 'active')
        .single();

      if (!enrollmentError && enrollment) {
        return next();
      }
    }

    res.status(403).json(createErrorResponse(
      'You do not have access to this course',
      403
    ));
  } catch (error) {
    console.error('Course access check error:', error);
    res.status(500).json(createErrorResponse('Server error', 500));
  }
};

// Check if user owns a resource (general purpose)
export const checkOwnership = (resourceType = 'resource') => {
  return async (req, res, next) => {
    try {
      const resourceId = req.params.id;
      const user = req.user;

      // Admins can access everything
      if (user.role === 'admin') {
        return next();
      }

      // For different resource types, implement different ownership checks
      switch (resourceType) {
        case 'course':
          return checkCourseAccess(req, res, next);

        case 'profile':
          if (resourceId === user.id) {
            return next();
          }
          break;

        default:
          // Generic ownership check - modify based on your needs
          if (resourceId === user.id) {
            return next();
          }
      }

      res.status(403).json(createErrorResponse(
        `You can only access your own ${resourceType}`,
        403
      ));
    } catch (error) {
      console.error('Ownership check error:', error);
      res.status(500).json(createErrorResponse('Server error', 500));
    }
  };
};

// Optional: Middleware to check if user is active
export const requireActiveUser = (req, res, next) => {
  if (!req.user.is_active) {
    return res.status(403).json(createErrorResponse(
      'Account is deactivated. Please contact support.',
      403
    ));
  }
  next();
};

// Export as default for convenience
export default {
  authenticateUser,
  authenticateToken,
  requireRole,
  checkCourseAccess,
  checkOwnership,
  requireActiveUser
};