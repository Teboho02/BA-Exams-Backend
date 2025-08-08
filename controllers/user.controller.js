// controllers/user.controller.js
const User = require('../models/User');
const Course = require('../models/Course');
const Assignment = require('../models/Assignment');
const Grade = require('../models/Grade');
const { validationResult } = require('express-validator');

class UserController {
  static async getUsers(req, res) {
    try {
      const { role, isActive, subject, search, page = 1, limit = 10 } = req.query;
      const filter = {};

      if (role) filter.role = role;
      if (isActive !== undefined) filter.isActive = isActive === 'true';
      if (subject) filter.subjects = subject;
      
      // Search by name or email
      if (search) {
        filter.$or = [
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ];
      }

      // Pagination
      const skip = (page - 1) * limit;

      const users = await User.find(filter)
        .select('-password')
        .populate('enrolledCourses', 'title code')
        .populate('teachingCourses', 'title code')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 });

      // Get total count for pagination
      const total = await User.countDocuments(filter);

      res.json({
        success: true,
        count: users.length,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        users
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async getUser(req, res) {
    try {
      const user = await User.findById(req.params.id)
        .select('-password')
        .populate('enrolledCourses', 'title code subject teacher')
        .populate('teachingCourses', 'title code subject students');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Get additional statistics based on role
      let statistics = {};
      
      if (user.role === 'student') {
        // Get student statistics
        const grades = await Grade.find({ student: user._id });
        const assignments = await Assignment.find({
          course: { $in: user.enrolledCourses.map(c => c._id) }
        });
        
        const submittedAssignments = assignments.filter(a => 
          a.submissions.some(s => s.student.toString() === user._id.toString())
        );

        statistics = {
          enrolledCourses: user.enrolledCourses.length,
          totalAssignments: assignments.length,
          submittedAssignments: submittedAssignments.length,
          pendingAssignments: assignments.length - submittedAssignments.length,
          averageGrade: grades.length > 0
            ? grades.reduce((sum, g) => sum + g.percentage, 0) / grades.length
            : 0
        };
      } else if (user.role === 'teacher') {
        // Get teacher statistics
        const totalStudents = user.teachingCourses.reduce((sum, course) => 
          sum + (course.students ? course.students.length : 0), 0
        );
        
        const assignments = await Assignment.find({
          course: { $in: user.teachingCourses.map(c => c._id) }
        });
        
        const totalSubmissions = assignments.reduce((sum, a) => 
          sum + a.submissions.length, 0
        );
        
        const gradedSubmissions = assignments.reduce((sum, a) => 
          sum + a.submissions.filter(s => s.grade !== undefined).length, 0
        );

        statistics = {
          teachingCourses: user.teachingCourses.length,
          totalStudents,
          totalAssignments: assignments.length,
          totalSubmissions,
          gradedSubmissions,
          pendingGrading: totalSubmissions - gradedSubmissions
        };
      }

      res.json({
        success: true,
        user: {
          ...user.toObject(),
          statistics
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async updateUser(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const updates = req.body;
      delete updates.password; // Prevent password update through this route
      delete updates.email; // Prevent email update without verification
      delete updates.role; // Only admins can change roles

      // If admin is updating, allow role change
      if (req.user.role === 'admin' && req.body.role) {
        updates.role = req.body.role;
      }

      const user = await User.findByIdAndUpdate(
        req.params.id,
        { $set: updates },
        { new: true, runValidators: true }
      ).select('-password');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.json({
        success: true,
        user
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async deleteUser(req, res) {
    try {
      // Soft delete - deactivate user
      const user = await User.findByIdAndUpdate(
        req.params.id,
        { isActive: false },
        { new: true }
      ).select('-password');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Remove user from enrolled courses
      if (user.role === 'student') {
        await Course.updateMany(
          { students: user._id },
          { $pull: { students: user._id } }
        );
      }

      res.json({
        success: true,
        message: 'User deactivated successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async getUserCourses(req, res) {
    try {
      const userId = req.params.id;
      const { isActive = true } = req.query;

      const user = await User.findById(userId).select('role');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      let courses;
      if (user.role === 'teacher') {
        courses = await Course.find({ 
          teacher: userId,
          isActive: isActive === 'true'
        })
        .populate('students', 'firstName lastName email')
        .sort({ createdAt: -1 });
      } else if (user.role === 'student') {
        courses = await Course.find({ 
          students: userId,
          isActive: isActive === 'true'
        })
        .populate('teacher', 'firstName lastName email')
        .sort({ createdAt: -1 });
      } else {
        courses = [];
      }

      // Add course statistics
      const coursesWithStats = await Promise.all(courses.map(async (course) => {
        const assignments = await Assignment.find({ course: course._id });
        const courseObj = course.toObject();
        
        if (user.role === 'student') {
          const submissions = assignments.reduce((count, assignment) => {
            const hasSubmitted = assignment.submissions.some(
              s => s.student.toString() === userId
            );
            return count + (hasSubmitted ? 1 : 0);
          }, 0);
          
          const grades = await Grade.find({
            student: userId,
            course: course._id
          });
          
          const averageGrade = grades.length > 0
            ? grades.reduce((sum, g) => sum + g.percentage, 0) / grades.length
            : 0;

          courseObj.statistics = {
            totalAssignments: assignments.length,
            submittedAssignments: submissions,
            pendingAssignments: assignments.length - submissions,
            averageGrade: parseFloat(averageGrade.toFixed(2))
          };
        } else if (user.role === 'teacher') {
          const totalSubmissions = assignments.reduce((sum, a) => 
            sum + a.submissions.length, 0
          );
          
          const gradedSubmissions = assignments.reduce((sum, a) => 
            sum + a.submissions.filter(s => s.grade !== undefined).length, 0
          );

          courseObj.statistics = {
            totalStudents: course.students.length,
            totalAssignments: assignments.length,
            totalSubmissions,
            gradedSubmissions,
            pendingGrading: totalSubmissions - gradedSubmissions
          };
        }
        
        return courseObj;
      }));

      res.json({
        success: true,
        count: coursesWithStats.length,
        courses: coursesWithStats
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async getUserAssignments(req, res) {
    try {
      const userId = req.params.id;
      const { courseId, type, status } = req.query;

      const user = await User.findById(userId).select('role enrolledCourses');
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Only students have assignments
      if (user.role !== 'student') {
        return res.status(400).json({
          success: false,
          message: 'Only students have assignments'
        });
      }

      const filter = {
        course: { $in: user.enrolledCourses }
      };
      
      if (courseId) filter.course = courseId;
      if (type) filter.type = type;

      const assignments = await Assignment.find(filter)
        .populate('course', 'title code')
        .sort({ dueDate: 1 });

      // Add submission status
      const assignmentsWithStatus = assignments.map(assignment => {
        const submission = assignment.submissions.find(
          s => s.student.toString() === userId
        );
        
        const now = new Date();
        const dueDate = new Date(assignment.dueDate);
        
        let assignmentStatus = 'pending';
        if (submission) {
          assignmentStatus = submission.grade !== undefined ? 'graded' : 'submitted';
        } else if (now > dueDate) {
          assignmentStatus = 'overdue';
        }

        const assignmentObj = assignment.toObject();
        assignmentObj.status = assignmentStatus;
        assignmentObj.submission = submission || null;
        
        // Remove all submissions from response for privacy
        delete assignmentObj.submissions;
        
        return assignmentObj;
      });

      // Filter by status if requested
      let filteredAssignments = assignmentsWithStatus;
      if (status) {
        filteredAssignments = assignmentsWithStatus.filter(a => a.status === status);
      }

      res.json({
        success: true,
        count: filteredAssignments.length,
        assignments: filteredAssignments
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async getUserGrades(req, res) {
    try {
      const userId = req.params.id;
      const { courseId, assignmentId } = req.query;

      // Verify access
      if (req.user.role === 'student' && req.user.id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      const filter = { student: userId };
      if (courseId) filter.course = courseId;
      if (assignmentId) filter.assignment = assignmentId;

      const grades = await Grade.find(filter)
        .populate('course', 'title code subject')
        .populate('assignment', 'title type totalPoints')
        .populate('gradedBy', 'firstName lastName')
        .sort({ gradedAt: -1 });

      // Group grades by course
      const gradesByCourse = grades.reduce((acc, grade) => {
        const courseId = grade.course._id.toString();
        if (!acc[courseId]) {
          acc[courseId] = {
            course: grade.course,
            grades: [],
            statistics: {
              totalScore: 0,
              totalMaxScore: 0,
              count: 0
            }
          };
        }
        
        acc[courseId].grades.push(grade);
        acc[courseId].statistics.totalScore += grade.score;
        acc[courseId].statistics.totalMaxScore += grade.maxScore;
        acc[courseId].statistics.count += 1;
        
        return acc;
      }, {});

      // Calculate statistics for each course
      Object.values(gradesByCourse).forEach(courseData => {
        const stats = courseData.statistics;
        stats.percentage = stats.totalMaxScore > 0
          ? (stats.totalScore / stats.totalMaxScore) * 100
          : 0;
        stats.letterGrade = this.calculateLetterGrade(stats.percentage);
      });

      res.json({
        success: true,
        count: grades.length,
        grades,
        gradesByCourse: Object.values(gradesByCourse)
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async getUserActivity(req, res) {
    try {
      const userId = req.params.id;
      const { days = 7 } = req.query;

      const user = await User.findById(userId).select('role firstName lastName');
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));

      let activity = {
        user: {
          id: user._id,
          name: `${user.firstName} ${user.lastName}`,
          role: user.role
        },
        period: {
          start: startDate,
          end: new Date(),
          days: parseInt(days)
        },
        summary: {}
      };

      if (user.role === 'student') {
        // Get recent submissions
        const recentSubmissions = await Assignment.aggregate([
          { $unwind: '$submissions' },
          {
            $match: {
              'submissions.student': userId,
              'submissions.submittedAt': { $gte: startDate }
            }
          },
          {
            $lookup: {
              from: 'courses',
              localField: 'course',
              foreignField: '_id',
              as: 'courseDetails'
            }
          },
          { $unwind: '$courseDetails' },
          {
            $project: {
              title: 1,
              type: 1,
              submittedAt: '$submissions.submittedAt',
              courseTitle: '$courseDetails.title',
              courseCode: '$courseDetails.code'
            }
          },
          { $sort: { submittedAt: -1 } }
        ]);

        // Get recent grades
        const recentGrades = await Grade.find({
          student: userId,
          gradedAt: { $gte: startDate }
        })
        .populate('assignment', 'title type')
        .populate('course', 'title code')
        .sort({ gradedAt: -1 });

        activity.summary = {
          submissionsCount: recentSubmissions.length,
          gradesReceived: recentGrades.length,
          averageGrade: recentGrades.length > 0
            ? recentGrades.reduce((sum, g) => sum + g.percentage, 0) / recentGrades.length
            : 0
        };
        
        activity.recentSubmissions = recentSubmissions.slice(0, 10);
        activity.recentGrades = recentGrades.slice(0, 10);
        
      } else if (user.role === 'teacher') {
        // Get recent grading activity
        const recentGrading = await Grade.find({
          gradedBy: userId,
          gradedAt: { $gte: startDate }
        })
        .populate('student', 'firstName lastName')
        .populate('assignment', 'title type')
        .populate('course', 'title code')
        .sort({ gradedAt: -1 });

        // Get recent assignments created
        const recentAssignments = await Assignment.find({
          createdAt: { $gte: startDate }
        })
        .populate('course', 'title code teacher')
        .sort({ createdAt: -1 });

        const teacherAssignments = recentAssignments.filter(a => 
          a.course.teacher.toString() === userId
        );

        activity.summary = {
          assignmentsCreated: teacherAssignments.length,
          gradesGiven: recentGrading.length,
          uniqueStudentsGraded: new Set(recentGrading.map(g => g.student._id.toString())).size
        };
        
        activity.recentGrading = recentGrading.slice(0, 10);
        activity.recentAssignments = teacherAssignments.slice(0, 10);
      }

      res.json({
        success: true,
        activity
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async resetPassword(req, res) {
    try {
      const { userId } = req.params;
      const { newPassword } = req.body;

      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 6 characters long'
        });
      }

      const user = await User.findById(userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      user.password = newPassword;
      await user.save();

      res.json({
        success: true,
        message: 'Password reset successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async toggleUserStatus(req, res) {
    try {
      const user = await User.findById(req.params.id);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      user.isActive = !user.isActive;
      await user.save();

      res.json({
        success: true,
        message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          isActive: user.isActive
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async getUserDashboard(req, res) {
    try {
      const userId = req.params.id || req.user.id;
      
      const user = await User.findById(userId)
        .select('-password')
        .populate('enrolledCourses', 'title code')
        .populate('teachingCourses', 'title code');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      let dashboard = {
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          subjects: user.subjects
        }
      };

      if (user.role === 'student') {
        // Get upcoming assignments
        const upcomingAssignments = await Assignment.find({
          course: { $in: user.enrolledCourses },
          dueDate: { $gte: new Date() }
        })
        .populate('course', 'title code')
        .sort({ dueDate: 1 })
        .limit(5);

        // Get recent grades
        const recentGrades = await Grade.find({ student: userId })
          .populate('assignment', 'title')
          .populate('course', 'title code')
          .sort({ gradedAt: -1 })
          .limit(5);

        // Calculate GPA
        const allGrades = await Grade.find({ student: userId });
        const gpa = allGrades.length > 0
          ? allGrades.reduce((sum, g) => sum + g.percentage, 0) / allGrades.length
          : 0;

        dashboard.enrolledCourses = user.enrolledCourses;
        dashboard.upcomingAssignments = upcomingAssignments;
        dashboard.recentGrades = recentGrades;
        dashboard.statistics = {
          gpa: parseFloat(gpa.toFixed(2)),
          totalCourses: user.enrolledCourses.length,
          completedAssignments: allGrades.length
        };
        
      } else if (user.role === 'teacher') {
        // Get courses with student count
        const coursesWithStats = await Course.find({ teacher: userId })
          .select('title code students')
          .lean();

        // Get pending grading
        const pendingGrading = await Assignment.aggregate([
          { $match: { course: { $in: user.teachingCourses.map(c => c._id) } } },
          { $unwind: '$submissions' },
          { $match: { 'submissions.grade': { $exists: false } } },
          {
            $lookup: {
              from: 'courses',
              localField: 'course',
              foreignField: '_id',
              as: 'courseDetails'
            }
          },
          { $unwind: '$courseDetails' },
          {
            $lookup: {
              from: 'users',
              localField: 'submissions.student',
              foreignField: '_id',
              as: 'studentDetails'
            }
          },
          { $unwind: '$studentDetails' },
          {
            $project: {
              title: 1,
              type: 1,
              courseTitle: '$courseDetails.title',
              studentName: { $concat: ['$studentDetails.firstName', ' ', '$studentDetails.lastName'] },
              submittedAt: '$submissions.submittedAt'
            }
          },
          { $sort: { submittedAt: 1 } },
          { $limit: 10 }
        ]);

        const totalStudents = coursesWithStats.reduce((sum, c) => sum + c.students.length, 0);

        dashboard.teachingCourses = user.teachingCourses;
        dashboard.pendingGrading = pendingGrading;
        dashboard.statistics = {
          totalCourses: user.teachingCourses.length,
          totalStudents,
          pendingGradingCount: pendingGrading.length
        };
      }

      res.json({
        success: true,
        dashboard
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

module.exports = UserController;