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
      return res
        .status(400)
        .json(createErrorResponse('Validation failed', errors.array()));
    }

    const { email, password } = req.body;

    // Sign in with Supabase Auth
    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (authError) {
      return res
        .status(401)
        .json(createErrorResponse('Invalid email or password'));
    }

    // Get user profile (must be active)
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .eq('is_active', true)
      .single();

    if (userError || !userData) {
      return res
        .status(401)
        .json(
          createErrorResponse('User account not found or deactivated'),
        );
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(userData.id);
    const isProduction = process.env.NODE_ENV === 'production';


    // const cookieOptions = {
    //   httpOnly: true,
    //   secure: isProduction, // false for localhost, true for production
    //   sameSite: isProduction ? 'None' : 'Lax', // Lax for localhost, None for cross-origin production
    //   maxAge: 1 * 24 * 60 * 60 * 1000, // 1 day
    // };

    // const refreshCookieOptions = {
    //   httpOnly: true,
    //   secure: isProduction,
    //   sameSite: isProduction ? 'None' : 'Lax',
    //   maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    // };

    const cookieOptions = {
      httpOnly: true,
      secure: isProduction, // Only true in HTTPS production
      sameSite: 'Lax', // Can use Lax for same-origin
      maxAge: 1 * 24 * 60 * 60 * 1000,
    };

    const refreshCookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'Lax', // Much more permissive than 'None'
      maxAge: 30 * 24 * 60 * 60 * 1000,
    };

    res.cookie('accessToken', accessToken, cookieOptions);
    res.cookie('refreshToken', refreshToken, refreshCookieOptions);
    // Set cookies with secure flags

    // Return response (no tokens in body for security, just user info)
    res.json(
      createSuccessResponse(
        {
          user: sanitizeUser(userData),
        },
        'Login successful',
      ),
    );
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json(createErrorResponse('Login failed'));
  }
};


// Add to existing imports
import { createClient } from '@supabase/supabase-js';

// Add Google Sign-In handler
export const googleSignIn = async (req, res) => {
  try {
    const { redirectTo = process.env.CLIENT_URL || 'http://localhost:3000' } = req.body;
    
    // Generate the Google OAuth URL
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${redirectTo}/auth/callback`, // Where to redirect after auth
        scopes: 'email profile', // Request email and profile info
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        }
      }
    });

    if (error) {
      console.error('Google sign-in error:', error);
      return res.status(400).json(createErrorResponse('Failed to initiate Google sign-in'));
    }

    // Return the OAuth URL for the frontend to redirect to
    res.json(createSuccessResponse({
      url: data.url
    }, 'Google sign-in URL generated'));

  } catch (error) {
    console.error('Google sign-in error:', error);
    res.status(500).json(createErrorResponse('Google sign-in failed'));
  }
};

// Handle Google OAuth callback
export const googleCallback = async (req, res) => {
  try {
    const { access_token, refresh_token } = req.body;

    if (!access_token) {
      return res.status(400).json(createErrorResponse('No access token provided'));
    }

    // Set the session using the tokens from Google
    const { data: { user }, error: sessionError } = await supabase.auth.setSession({
      access_token,
      refresh_token
    });

    if (sessionError) {
      console.error('Session error:', sessionError);
      return res.status(400).json(createErrorResponse('Failed to create session'));
    }

    if (!user) {
      return res.status(400).json(createErrorResponse('No user data received'));
    }

    // Check if user exists in our database
    let { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    // If user doesn't exist, create profile
    if (userError && userError.code === 'PGRST116') {
      const googleProfile = user.user_metadata;
      
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          id: user.id,
          email: user.email,
          first_name: googleProfile.given_name || googleProfile.full_name?.split(' ')[0] || '',
          last_name: googleProfile.family_name || googleProfile.full_name?.split(' ').slice(1).join(' ') || '',
          avatar_url: googleProfile.avatar_url || googleProfile.picture,
          role: 'student', // Default role
          is_active: true,
          auth_provider: 'google',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (createError) {
        console.error('Create user error:', createError);
        return res.status(500).json(createErrorResponse('Failed to create user profile'));
      }

      userData = newUser;
    } else if (userError) {
      console.error('Database error:', userError);
      return res.status(500).json(createErrorResponse('Database error'));
    }

    // Generate our own JWT tokens
    const { accessToken, refreshToken: jwtRefreshToken } = generateTokens(userData.id);
    
    // Set cookies
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'Lax',
      maxAge: 1 * 24 * 60 * 60 * 1000,
    };

    const refreshCookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'Lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    };

    res.cookie('accessToken', accessToken, cookieOptions);
    res.cookie('refreshToken', jwtRefreshToken, refreshCookieOptions);

    // Return user data
    res.json(createSuccessResponse({
      user: sanitizeUser(userData)
    }, 'Google sign-in successful'));

  } catch (error) {
    console.error('Google callback error:', error);
    res.status(500).json(createErrorResponse('Failed to process Google sign-in'));
  }
};

// Logout user (with token blacklisting if needed)
// Logout user (with token blacklisting if needed)
export const logout = async (req, res) => {
  try {
    // Cookie configuration for development vs production (same as login)
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction, // false for localhost, true for production
      sameSite: isProduction ? 'None' : 'Lax', // Lax for localhost, None for cross-origin production
      path: '/', // must match login cookie path
    };

    res.clearCookie('accessToken', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);

    res.json(createSuccessResponse({}, 'Logout successful'));
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json(createErrorResponse('Logout failed'));
  }
};

// Refresh access token
export const refreshToken = async (req, res) => {
  try {
    let token = req.cookies.refreshToken;

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
// authController.js

export const SendResetPasswordLink = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json(createErrorResponse('Email is required'));
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json(createErrorResponse('Invalid email format'));
    }

    // Send password reset email via Supabase
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.CLIENT_URL || 'http://localhost:3000'}/reset-password`
    });

    if (error) {
      console.error('Reset password error:', error);
      return res.status(400).json(createErrorResponse('Failed to send reset email'));
    }

    // For security, always return success even if email doesn't exist
    res.json(createSuccessResponse({}, 'If an account exists with this email, a password reset link has been sent'));
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json(createErrorResponse('Failed to process request'));
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json(createErrorResponse('Token and new password are required'));
    }

    if (newPassword.length < 8) {
      return res.status(400).json(createErrorResponse('New password must be at least 8 characters long'));
    }

    // Verify the token and update password
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) {
      console.error('Password reset confirmation error:', error);
      return res.status(400).json(createErrorResponse('Invalid or expired reset token'));
    }

    res.json(createSuccessResponse({}, 'Password reset successfully'));

  } catch (error) {
    console.error('Reset password confirmation error:', error);
    res.status(500).json(createErrorResponse('Failed to reset password'));
  }
};

// For authenticated users to change their password (requires current password verification)
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json(createErrorResponse('Current password and new password are required'));
    }

    if (newPassword.length < 8) {
      return res.status(400).json(createErrorResponse('New password must be at least 8 characters long'));
    }

    // First, verify current password by signing in
    const { data: userData, error: userError } = await supabase.auth.getUser();
    
    if (userError) {
      return res.status(401).json(createErrorResponse('Authentication required'));
    }

    // Update password using the standard method (user must be authenticated)
    const { error } = await supabase.auth.updateUser({
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
  changePassword,
  SendResetPasswordLink,
  resetPassword,
};