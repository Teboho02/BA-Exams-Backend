
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

class UserSchema {
  static createSchema() {
    const schema = new mongoose.Schema({
      firstName: {
        type: String,
        required: [true, 'First name is required'],
        trim: true
      },
      lastName: {
        type: String,
        required: [true, 'Last name is required'],
        trim: true
      },
      email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
      },
      password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: 6,
        select: false
      },
      role: {
        type: String,
        enum: ['student', 'teacher', 'admin'],
        default: 'student'
      },
      subjects: [{
        type: String,
        enum: ['mathematics', 'physics', 'chemistry']
      }],
      enrolledCourses: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course'
      }],
      teachingCourses: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course'
      }],
      isActive: {
        type: Boolean,
        default: true
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    });

    // Hash password before saving
    schema.pre('save', async function(next) {
      if (!this.isModified('password')) return next();
      
      try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
      } catch (error) {
        next(error);
      }
    });

    // Compare password method
    schema.methods.comparePassword = async function(candidatePassword) {
      return await bcrypt.compare(candidatePassword, this.password);
    };

    return schema;
  }
}

module.exports = mongoose.model('User', UserSchema.createSchema());
