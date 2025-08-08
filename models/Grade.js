
const mongoose = require('mongoose');

class GradeSchema {
  static createSchema() {
    const schema = new mongoose.Schema({
      student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      course: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        required: true
      },
      assignment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Assignment',
        required: true
      },
      score: {
        type: Number,
        required: true,
        min: 0
      },
      maxScore: {
        type: Number,
        required: true,
        min: 0
      },
      percentage: {
        type: Number,
        default: function() {
          return (this.score / this.maxScore) * 100;
        }
      },
      letterGrade: {
        type: String,
        enum: ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F']
      },
      feedback: String,
      gradedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      gradedAt: {
        type: Date,
        default: Date.now
      }
    });

    // Calculate letter grade before saving
    schema.pre('save', function(next) {
      const percentage = (this.score / this.maxScore) * 100;
      if (percentage >= 97) this.letterGrade = 'A+';
      else if (percentage >= 93) this.letterGrade = 'A';
      else if (percentage >= 90) this.letterGrade = 'A-';
      else if (percentage >= 87) this.letterGrade = 'B+';
      else if (percentage >= 83) this.letterGrade = 'B';
      else if (percentage >= 80) this.letterGrade = 'B-';
      else if (percentage >= 77) this.letterGrade = 'C+';
      else if (percentage >= 73) this.letterGrade = 'C';
      else if (percentage >= 70) this.letterGrade = 'C-';
      else if (percentage >= 60) this.letterGrade = 'D';
      else this.letterGrade = 'F';
      next();
    });

    return schema;
  }
}

module.exports = mongoose.model('Grade', GradeSchema.createSchema());
