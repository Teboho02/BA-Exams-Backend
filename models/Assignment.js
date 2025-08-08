
const mongoose = require('mongoose');

class AssignmentSchema {
  static createSchema() {
    const schema = new mongoose.Schema({
      title: {
        type: String,
        required: [true, 'Assignment title is required']
      },
      description: {
        type: String,
        required: [true, 'Assignment description is required']
      },
      course: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        required: true
      },
      type: {
        type: String,
        enum: ['homework', 'quiz', 'exam', 'project'],
        required: true
      },
      totalPoints: {
        type: Number,
        required: true,
        min: 0
      },
      dueDate: {
        type: Date,
        required: true
      },
      instructions: String,
      attachments: [{
        filename: String,
        url: String
      }],
      submissions: [{
        student: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        submittedAt: {
          type: Date,
          default: Date.now
        },
        content: String,
        attachments: [{
          filename: String,
          url: String
        }],
        grade: Number,
        feedback: String,
        gradedAt: Date,
        gradedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        }
      }],
      createdAt: {
        type: Date,
        default: Date.now
      }
    });

    return schema;
  }
}

module.exports = mongoose.model('Assignment', AssignmentSchema.createSchema());
