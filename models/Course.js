const mongoose = require('mongoose');

class CourseSchema {
  static createSchema() {
    const schema = new mongoose.Schema({
      title: {
        type: String,
        required: [true, 'Course title is required'],
        trim: true
      },
      description: {
        type: String,
        required: [true, 'Course description is required']
      },
      subject: {
        type: String,
        required: true,
        enum: ['mathematics', 'physics']
      },
      code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true
      },
      teacher: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      students: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }],
      modules: [{
        title: String,
        content: String,
        resources: [{
          title: String,
          url: String,
          type: {
            type: String,
            enum: ['video', 'document', 'link', 'assignment']
          }
        }],
        order: Number
      }],
      isActive: {
        type: Boolean,
        default: true
      },
      startDate: Date,
      endDate: Date,
      createdAt: {
        type: Date,
        default: Date.now
      }
    });

    return schema;
  }
}

module.exports = mongoose.model('Course', CourseSchema.createSchema());
