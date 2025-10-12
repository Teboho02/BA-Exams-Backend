// routes/auth.routes.js
import express from 'express';
import { body } from 'express-validator';
import { 
  authenticateUser, 
  authenticateToken, 
  requireRole 
} from '../middleware/auth.middleware.js';
import {
  register,
  login,
  logout,
  refreshToken,
  getProfile,
  updateProfile,
  googleSignIn,
  googleCallback,
  SendResetPasswordLink,
  resetPassword
} from '../controllers/auth.controller.js';

const router = express.Router();

// Validation rules
const registerValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('firstName')
    .trim()
    .notEmpty()
    .withMessage('First name is required'),
  body('lastName')
    .trim()
    .notEmpty()
    .withMessage('Last name is required'),
  body('role')
    .optional()
    .isIn(['student', 'teacher'])
    .withMessage('Role must be either student or teacher')
];

const loginValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

// Public routes
router.post('/register', registerValidation, register);
router.post('/login', loginValidation, login);
router.post('/refresh-token', refreshToken);
router.post('/google', googleSignIn);
router.post('/google/callback', googleCallback);
router.post('/reset-password', SendResetPasswordLink);
router.post('/resetpassword/:token', resetPassword);

// Protected routes
router.post('/logout', authenticateUser, logout);
router.get('/profile', authenticateUser, getProfile);
router.put('/profile', authenticateUser, updateProfile);



// Admin only routes
router.get('/users', authenticateUser, requireRole(['admin']), (req, res) => {
  res.json({ message: 'Admin users endpoint - implement in controller' });
});

router.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'API is healthy' });
});


export default router;