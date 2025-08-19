// controllers/auth.controller.js
import { validationResult } from 'express-validator';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
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

const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  const refreshToken = jwt.sign(
    { id: userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

  return { accessToken, refreshToken };
};

const sanitizeUser = (user) => ({
  id: user.id,
  firstName: user.first_name,
  lastName: user.last_name,
  email: user.email,
  role: user.role,
  avatarUrl: user.avatar_url,
  phone: user.phone,
  dateOfBirth: user.date_of_birth,
  isActive: user.is_active,
  createdAt: user.created_at,
  updatedAt: user.updated_at
});

// Register new user
// Simple registration function - replace the existing one
export const register = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(createErrorResponse('Validation failed', errors.array()));
    }

    const { email, password, firstName, lastName, role = 'student' } = req.body;

    // Sign up user with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          role: role
        }
      }
    });

    if (authError) {
      console.error('Supabase auth error:', authError);
      return res.status(400).json(createErrorResponse(authError.message));
    }

    if (!authData.user) {
      return res.status(400).json(createErrorResponse('Failed to create user'));
    }

    // Generate our own JWT tokens
    const { accessToken, refreshToken } = generateTokens(authData.user.id);

    // Return user data (the database trigger will create the profile)
    res.status(201).json(createSuccessResponse(
       'User registered successfully'));

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json(createErrorResponse('Registration failed'));
  }
};

export const login = async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(createErrorResponse('Validation failed', errors.array()));
    }

    const { email, password } = req.body;

    // Sign in with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      return res.status(401).json(createErrorResponse('Invalid email or password'));
    }

    // Get user profile
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .eq('is_active', true)
      .single();

    if (userError || !userData) {
      return res.status(401).json(createErrorResponse('User account not found or deactivated'));
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(userData.id);

    // Set cookies (optional - for additional security)
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    // Send tokens in response body for frontend to use
res.json(createSuccessResponse({
  user: sanitizeUser(userData),   
}, 'Login successful'));

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json(createErrorResponse('Login failed'));
  }
};

// Logout user (with token blacklisting if needed)
export const logout = async (req, res) => {
  try {

    
    res.json(createSuccessResponse({}, 'Logout successful'));
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json(createErrorResponse('Logout failed'));
  }
};

// Refresh access token
export const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      return res.status(401).json(createErrorResponse('Refresh token required'));
    }

    // Verify refresh token
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    
    if (decoded.type !== 'refresh') {
      return res.status(401).json(createErrorResponse('Invalid refresh token'));
    }

    // Check if user still exists and is active
    const { data: userData, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.id)
      .eq('is_active', true)
      .single();

    if (error || !userData) {
      return res.status(401).json(createErrorResponse('User not found or deactivated'));
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(userData.id);

    res.json(createSuccessResponse({
      user: sanitizeUser(userData),
      accessToken,
      refreshToken: newRefreshToken
    }));

  } catch (error) {
    console.error('Refresh token error:', error);
    
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json(createErrorResponse('Invalid or expired refresh token'));
    }
    
    res.status(500).json(createErrorResponse('Token refresh failed'));
  }
};

// Get user profile
export const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get updated user data
      const { data: userData, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (error || !userData) {
        return res.status(404).json(createErrorResponse('User profile not found'));
      }

      res.json(createSuccessResponse({
        user: sanitizeUser(userData)
      }));

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json(createErrorResponse('Failed to fetch profile'));
  }
};

// Update user profile
export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const updates = req.body;

    // Remove sensitive fields that shouldn't be updated via this endpoint
    const {
      id, email, role, is_active, created_at, updated_at, ...allowedUpdates
    } = updates;

    // Convert camelCase to snake_case for database
    const dbUpdates = {};
    Object.keys(allowedUpdates).forEach(key => {
      switch (key) {
        case 'firstName':
          dbUpdates.first_name = allowedUpdates[key];
          break;
        case 'lastName':
          dbUpdates.last_name = allowedUpdates[key];
          break;
        case 'avatarUrl':
          dbUpdates.avatar_url = allowedUpdates[key];
          break;
        case 'dateOfBirth':
          dbUpdates.date_of_birth = allowedUpdates[key];
          break;
        default:
          dbUpdates[key] = allowedUpdates[key];
      }
    });

    // Update user profile
    const { data: userData, error } = await supabase
      .from('users')
      .update({
        ...dbUpdates,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('Update profile error:', error);
      return res.status(400).json(createErrorResponse('Failed to update profile'));
    }

    res.json(createSuccessResponse({
      user: sanitizeUser(userData)
    }, 'Profile updated successfully'));

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json(createErrorResponse('Failed to update profile'));
  }
};

// Change password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json(createErrorResponse('Current password and new password are required'));
    }

    if (newPassword.length < 6) {
      return res.status(400).json(createErrorResponse('New password must be at least 6 characters long'));
    }

    // Update password in Supabase Auth
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      password: newPassword
    });

    if (error) {
      console.error('Password change error:', error);
      return res.status(400).json(createErrorResponse('Failed to change password'));
    }

    res.json(createSuccessResponse({}, 'Password changed successfully'));

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json(createErrorResponse('Failed to change password'));
  }
};

// Export all functions
export default {
  register,
  login,
  logout,
  refreshToken,
  getProfile,
  updateProfile,
  changePassword
};