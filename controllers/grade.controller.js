// controllers/grade.controller.js
const Grade = require('../models/Grade');
const Course = require('../models/Course');
const Assignment = require('../models/Assignment');
const User = require('../models/User');
const { validationResult } = require('express-validator');

class GradeController {
  static async createGrade(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      // Check if grade already exists
      const existingGrade = await Grade.findOne({
        student: req.body.student,
        assignment: req.body.assignment
      });

      if (existingGrade) {
        return res.status(400).json({
          success: false,
          message: 'Grade already exists for this student and assignment'
        });
      }

      const gradeData = {
        ...req.body,
        gradedBy: req.user.id
      };

      const grade = await Grade.create(gradeData);

      // Populate the created grade
      await grade.populate([
        { path: 'student', select: 'firstName lastName email' },
        { path: 'course', select: 'title code' },
        { path: 'assignment', select: 'title type' },
        { path: 'gradedBy', select: 'firstName lastName' }
      ]);

      res.status(201).json({
        success: true,
        grade
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async getGrades(req, res) {
    try {
      const { studentId, courseId, assignmentId, letterGrade, minPercentage, maxPercentage } = req.query;
      const filter = {};

      // Build filter based on query params and user role
      if (req.user.role === 'student') {
        filter.student = req.user.id;
      } else if (studentId) {
        filter.student = studentId;
      }

      if (courseId) filter.course = courseId;
      if (assignmentId) filter.assignment = assignmentId;
      if (letterGrade) filter.letterGrade = letterGrade;
      
      if (minPercentage || maxPercentage) {
        filter.percentage = {};
        if (minPercentage) filter.percentage.$gte = parseFloat(minPercentage);
        if (maxPercentage) filter.percentage.$lte = parseFloat(maxPercentage);
      }

      const grades = await Grade.find(filter)
        .populate('student', 'firstName lastName email')
        .populate('course', 'title code')
        .populate('assignment', 'title type totalPoints dueDate')
        .populate('gradedBy', 'firstName lastName')
        .sort({ gradedAt: -1 });

      res.json({
        success: true,
        count: grades.length,
        grades
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async getGrade(req, res) {
    try {
      const grade = await Grade.findById(req.params.id)
        .populate('student', 'firstName lastName email')
        .populate('course', 'title code subject')
        .populate('assignment', 'title type totalPoints dueDate instructions')
        .populate('gradedBy', 'firstName lastName');

      if (!grade) {
        return res.status(404).json({
          success: false,
          message: 'Grade not found'
        });
      }

      // Check access permissions
      if (req.user.role === 'student' && grade.student._id.toString() !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      res.json({
        success: true,
        grade
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async updateGrade(req, res) {
    try {
      const { score, feedback } = req.body;

      const grade = await Grade.findById(req.params.id);
      
      if (!grade) {
        return res.status(404).json({
          success: false,
          message: 'Grade not found'
        });
      }

      // Validate score against max score
      if (score !== undefined && score > grade.maxScore) {
        return res.status(400).json({
          success: false,
          message: `Score cannot exceed maximum score of ${grade.maxScore}`
        });
      }

      // Update grade
      if (score !== undefined) grade.score = score;
      if (feedback !== undefined) grade.feedback = feedback;
      grade.gradedBy = req.user.id;
      grade.gradedAt = new Date();

      await grade.save();

      // Populate updated grade
      await grade.populate([
        { path: 'student', select: 'firstName lastName email' },
        { path: 'course', select: 'title code' },
        { path: 'assignment', select: 'title type' },
        { path: 'gradedBy', select: 'firstName lastName' }
      ]);

      res.json({
        success: true,
        grade
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async deleteGrade(req, res) {
    try {
      const grade = await Grade.findByIdAndDelete(req.params.id);

      if (!grade) {
        return res.status(404).json({
          success: false,
          message: 'Grade not found'
        });
      }

      res.json({
        success: true,
        message: 'Grade deleted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async getStudentGradeSummary(req, res) {
    try {
      const studentId = req.params.studentId || req.user.id;
      const { courseId } = req.query;

      // Verify student access
      if (req.user.role === 'student' && studentId !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      const matchQuery = { student: studentId };
      if (courseId) matchQuery.course = courseId;

      const grades = await Grade.aggregate([
        { $match: matchQuery },
        {
          $lookup: {
            from: 'assignments',
            localField: 'assignment',
            foreignField: '_id',
            as: 'assignmentDetails'
          }
        },
        { $unwind: '$assignmentDetails' },
        {
          $group: {
            _id: {
              course: '$course',
              type: '$assignmentDetails.type'
            },
            totalScore: { $sum: '$score' },
            totalMaxScore: { $sum: '$maxScore' },
            count: { $sum: 1 },
            averagePercentage: { $avg: '$percentage' },
            grades: {
              $push: {
                assignment: '$assignment',
                score: '$score',
                maxScore: '$maxScore',
                percentage: '$percentage',
                letterGrade: '$letterGrade'
              }
            }
          }
        },
        {
          $lookup: {
            from: 'courses',
            localField: '_id.course',
            foreignField: '_id',
            as: 'courseDetails'
          }
        },
        { $unwind: '$courseDetails' },
        {
          $group: {
            _id: '$_id.course',
            courseName: { $first: '$courseDetails.title' },
            courseCode: { $first: '$courseDetails.code' },
            courseSubject: { $first: '$courseDetails.subject' },
            gradesByType: {
              $push: {
                type: '$_id.type',
                totalScore: '$totalScore',
                totalMaxScore: '$totalMaxScore',
                count: '$count',
                averagePercentage: '$averagePercentage',
                grades: '$grades'
              }
            },
            overallScore: { $sum: '$totalScore' },
            overallMaxScore: { $sum: '$totalMaxScore' }
          }
        },
        {
          $project: {
            courseName: 1,
            courseCode: 1,
            courseSubject: 1,
            gradesByType: 1,
            overallScore: 1,
            overallMaxScore: 1,
            overallPercentage: {
              $multiply: [
                { $divide: ['$overallScore', '$overallMaxScore'] },
                100
              ]
            },
            overallLetterGrade: {
              $switch: {
                branches: [
                  { case: { $gte: [{ $multiply: [{ $divide: ['$overallScore', '$overallMaxScore'] }, 100] }, 97] }, then: 'A+' },
                  { case: { $gte: [{ $multiply: [{ $divide: ['$overallScore', '$overallMaxScore'] }, 100] }, 93] }, then: 'A' },
                  { case: { $gte: [{ $multiply: [{ $divide: ['$overallScore', '$overallMaxScore'] }, 100] }, 90] }, then: 'A-' },
                  { case: { $gte: [{ $multiply: [{ $divide: ['$overallScore', '$overallMaxScore'] }, 100] }, 87] }, then: 'B+' },
                  { case: { $gte: [{ $multiply: [{ $divide: ['$overallScore', '$overallMaxScore'] }, 100] }, 83] }, then: 'B' },
                  { case: { $gte: [{ $multiply: [{ $divide: ['$overallScore', '$overallMaxScore'] }, 100] }, 80] }, then: 'B-' },
                  { case: { $gte: [{ $multiply: [{ $divide: ['$overallScore', '$overallMaxScore'] }, 100] }, 77] }, then: 'C+' },
                  { case: { $gte: [{ $multiply: [{ $divide: ['$overallScore', '$overallMaxScore'] }, 100] }, 73] }, then: 'C' },
                  { case: { $gte: [{ $multiply: [{ $divide: ['$overallScore', '$overallMaxScore'] }, 100] }, 70] }, then: 'C-' },
                  { case: { $gte: [{ $multiply: [{ $divide: ['$overallScore', '$overallMaxScore'] }, 100] }, 60] }, then: 'D' }
                ],
                default: 'F'
              }
            }
          }
        },
        { $sort: { courseCode: 1 } }
      ]);

      // Get student info
      const student = await User.findById(studentId).select('firstName lastName email');

      res.json({
        success: true,
        student: {
          id: student._id,
          name: `${student.firstName} ${student.lastName}`,
          email: student.email
        },
        summary: grades
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async getCourseGradebook(req, res) {
    try {
      const { courseId } = req.params;

      // Verify teacher access
      if (req.user.role === 'teacher') {
        const course = await Course.findById(courseId);
        if (!course || course.teacher.toString() !== req.user.id) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
      }

      // Get all students in the course
      const course = await Course.findById(courseId)
        .populate('students', 'firstName lastName email')
        .select('title code students');

      if (!course) {
        return res.status(404).json({
          success: false,
          message: 'Course not found'
        });
      }

      // Get all assignments for the course
      const assignments = await Assignment.find({ course: courseId })
        .select('title type totalPoints dueDate')
        .sort({ dueDate: 1 });

      // Get all grades for the course
      const grades = await Grade.find({ course: courseId })
        .select('student assignment score maxScore percentage letterGrade');

      // Create gradebook matrix
      const gradebook = {
        course: {
          id: course._id,
          title: course.title,
          code: course.code
        },
        assignments: assignments.map(a => ({
          id: a._id,
          title: a.title,
          type: a.type,
          totalPoints: a.totalPoints,
          dueDate: a.dueDate
        })),
        students: course.students.map(student => {
          const studentGrades = {};
          let totalScore = 0;
          let totalMaxScore = 0;

          assignments.forEach(assignment => {
            const grade = grades.find(g => 
              g.student.toString() === student._id.toString() && 
              g.assignment.toString() === assignment._id.toString()
            );

            if (grade) {
              studentGrades[assignment._id] = {
                score: grade.score,
                maxScore: grade.maxScore,
                percentage: grade.percentage,
                letterGrade: grade.letterGrade
              };
              totalScore += grade.score;
              totalMaxScore += grade.maxScore;
            } else {
              studentGrades[assignment._id] = null;
            }
          });

          const overallPercentage = totalMaxScore > 0 ? (totalScore / totalMaxScore) * 100 : 0;

          return {
            id: student._id,
            firstName: student.firstName,
            lastName: student.lastName,
            email: student.email,
            grades: studentGrades,
            summary: {
              totalScore,
              totalMaxScore,
              overallPercentage,
              overallLetterGrade: this.calculateLetterGrade(overallPercentage)
            }
          };
        })
      };

      res.json({
        success: true,
        gradebook
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async getClassStatistics(req, res) {
    try {
      const { courseId } = req.params;
      const { assignmentId } = req.query;

      const filter = { course: courseId };
      if (assignmentId) filter.assignment = assignmentId;

      const grades = await Grade.find(filter);

      if (grades.length === 0) {
        return res.json({
          success: true,
          statistics: {
            count: 0,
            average: 0,
            median: 0,
            highest: 0,
            lowest: 0,
            standardDeviation: 0,
            letterGradeDistribution: {}
          }
        });
      }

      const percentages = grades.map(g => g.percentage);
      const sorted = percentages.sort((a, b) => a - b);

      // Calculate statistics
      const sum = percentages.reduce((a, b) => a + b, 0);
      const average = sum / percentages.length;
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];

      // Calculate standard deviation
      const squaredDifferences = percentages.map(p => Math.pow(p - average, 2));
      const avgSquaredDiff = squaredDifferences.reduce((a, b) => a + b, 0) / percentages.length;
      const standardDeviation = Math.sqrt(avgSquaredDiff);

      // Letter grade distribution
      const letterGradeDistribution = grades.reduce((acc, grade) => {
        acc[grade.letterGrade] = (acc[grade.letterGrade] || 0) + 1;
        return acc;
      }, {});

      // Get course and assignment details
      const course = await Course.findById(courseId).select('title code');
      let assignment = null;
      if (assignmentId) {
        assignment = await Assignment.findById(assignmentId).select('title type');
      }

      res.json({
        success: true,
        course: {
          id: course._id,
          title: course.title,
          code: course.code
        },
        assignment: assignment ? {
          id: assignment._id,
          title: assignment.title,
          type: assignment.type
        } : null,
        statistics: {
          count: grades.length,
          average: parseFloat(average.toFixed(2)),
          median: parseFloat(median.toFixed(2)),
          highest: Math.max(...percentages),
          lowest: Math.min(...percentages),
          standardDeviation: parseFloat(standardDeviation.toFixed(2)),
          letterGradeDistribution,
          percentageRanges: {
            '90-100': percentages.filter(p => p >= 90).length,
            '80-89': percentages.filter(p => p >= 80 && p < 90).length,
            '70-79': percentages.filter(p => p >= 70 && p < 80).length,
            '60-69': percentages.filter(p => p >= 60 && p < 70).length,
            '0-59': percentages.filter(p => p < 60).length
          }
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async exportGrades(req, res) {
    try {
      const { courseId } = req.params;
      const { format = 'json' } = req.query;

      // Get gradebook data
      const gradebookResponse = await this.getCourseGradebook({
        params: { courseId },
        user: req.user
      }, {
        json: (data) => data,
        status: () => ({ json: (data) => data })
      });

      if (!gradebookResponse.success) {
        return res.status(404).json(gradebookResponse);
      }

      const gradebook = gradebookResponse.gradebook;

      if (format === 'csv') {
        // Generate CSV
        let csv = 'Student Name,Student Email,';
        
        // Add assignment headers
        gradebook.assignments.forEach(a => {
          csv += `"${a.title} (${a.totalPoints} pts)",`;
        });
        csv += 'Total Score,Overall Percentage,Letter Grade\n';

        // Add student rows
        gradebook.students.forEach(student => {
          csv += `"${student.firstName} ${student.lastName}",${student.email},`;
          
          gradebook.assignments.forEach(assignment => {
            const grade = student.grades[assignment.id];
            csv += grade ? `${grade.score}/${grade.maxScore},` : 'N/A,';
          });
          
          csv += `${student.summary.totalScore}/${student.summary.totalMaxScore},`;
          csv += `${student.summary.overallPercentage.toFixed(2)}%,`;
          csv += `${student.summary.overallLetterGrade}\n`;
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${gradebook.course.code}-grades.csv"`);
        return res.send(csv);
      }

      // Default to JSON format
      res.json({
        success: true,
        gradebook
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async bulkCreateGrades(req, res) {
    try {
      const { grades } = req.body;
      
      if (!Array.isArray(grades) || grades.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Please provide an array of grades'
        });
      }

      const createdGrades = [];
      const errors = [];

      for (const gradeData of grades) {
        try {
          // Check if grade already exists
          const existingGrade = await Grade.findOne({
            student: gradeData.student,
            assignment: gradeData.assignment
          });

          if (existingGrade) {
            errors.push({
              student: gradeData.student,
              assignment: gradeData.assignment,
              error: 'Grade already exists'
            });
            continue;
          }

          const grade = await Grade.create({
            ...gradeData,
            gradedBy: req.user.id
          });

          createdGrades.push(grade);
        } catch (error) {
          errors.push({
            student: gradeData.student,
            assignment: gradeData.assignment,
            error: error.message
          });
        }
      }

      res.json({
        success: true,
        message: `Created ${createdGrades.length} grades`,
        created: createdGrades.length,
        errors: errors.length,
        errorDetails: errors
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static calculateLetterGrade(percentage) {
    if (percentage >= 97) return 'A+';
    if (percentage >= 93) return 'A';
    if (percentage >= 90) return 'A-';
    if (percentage >= 87) return 'B+';
    if (percentage >= 83) return 'B';
    if (percentage >= 80) return 'B-';
    if (percentage >= 77) return 'C+';
    if (percentage >= 73) return 'C';
    if (percentage >= 70) return 'C-';
    if (percentage >= 60) return 'D';
    return 'F';
  }
}

module.exports = GradeController;