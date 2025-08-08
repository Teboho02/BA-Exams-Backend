

// API Endpoints for Student Grades System
// These endpoints work with your existing database schema

// 1. GET /api/student/grades - Get student's overall grades and course overview
app.get('/api/student/grades', authenticateToken, async (req, res) => {
  try {
    const studentId = req.user.id;

    // Get enrolled courses with grade calculations
    const coursesQuery = `
      SELECT 
        c.id,
        c.title,
        c.code,
        c.subject,
        c.description,
        c.credits,
        u.first_name as instructor_first_name,
        u.last_name as instructor_last_name,
        u.email as instructor_email,
        ce.enrolled_at,
        ce.status as enrollment_status,
        ce.grade as final_grade,
        ce.final_score,
        -- Calculate assignment statistics
        COUNT(a.id) as total_assignments,
        COUNT(CASE WHEN sub.status = 'graded' THEN 1 END) as graded_assignments,
        COUNT(CASE WHEN sub.status IN ('submitted', 'graded') THEN 1 END) as completed_assignments,
        -- Calculate total possible points and earned points
        COALESCE(SUM(CASE WHEN a.is_published = true THEN a.max_points END), 0) as total_possible_points,
        COALESCE(SUM(CASE WHEN sub.status = 'graded' THEN sub.score END), 0) as total_earned_points,
        -- Calculate average percentage
        CASE 
          WHEN SUM(CASE WHEN a.is_published = true THEN a.max_points END) > 0 THEN
            (SUM(CASE WHEN sub.status = 'graded' THEN sub.score END)::float / 
             SUM(CASE WHEN a.is_published = true THEN a.max_points END)::float) * 100
          ELSE 0
        END as average_percentage
      FROM course_enrollments ce
      JOIN courses c ON ce.course_id = c.id
      JOIN users u ON c.instructor_id = u.id
      LEFT JOIN assignments a ON c.id = a.course_id AND a.is_published = true
      LEFT JOIN assignment_submissions sub ON a.id = sub.assignment_id AND sub.student_id = ce.student_id
      WHERE ce.student_id = $1 AND ce.status = 'active'
      GROUP BY c.id, c.title, c.code, c.subject, c.description, c.credits,
               u.first_name, u.last_name, u.email, ce.enrolled_at, ce.status, ce.grade, ce.final_score
      ORDER BY ce.enrolled_at DESC
    `;

    const coursesResult = await db.query(coursesQuery, [studentId]);

    // Calculate letter grades
    const courses = coursesResult.rows.map(course => {
      const percentage = parseFloat(course.average_percentage) || 0;
      let letterGrade = 'F';
      
      if (percentage >= 90) letterGrade = 'A';
      else if (percentage >= 80) letterGrade = 'B';
      else if (percentage >= 70) letterGrade = 'C';
      else if (percentage >= 60) letterGrade = 'D';

      return {
        id: course.id,
        title: course.title,
        code: course.code,
        subject: course.subject,
        description: course.description,
        credits: course.credits,
        instructor: {
          firstName: course.instructor_first_name,
          lastName: course.instructor_last_name,
          email: course.instructor_email
        },
        enrollmentDate: course.enrolled_at,
        enrollmentStatus: course.enrollment_status,
        totalPoints: parseInt(course.total_possible_points) || 0,
        earnedPoints: parseInt(course.total_earned_points) || 0,
        averageGrade: Math.round(percentage * 10) / 10,
        letterGrade: letterGrade,
        completedAssignments: parseInt(course.completed_assignments) || 0,
        totalAssignments: parseInt(course.total_assignments) || 0,
        finalScore: course.final_score
      };
    });

    // Calculate overall statistics
    const totalCourses = courses.length;
    const totalAssignments = courses.reduce((sum, course) => sum + course.totalAssignments, 0);
    const completedAssignments = courses.reduce((sum, course) => sum + course.completedAssignments, 0);
    const averagePercentage = courses.length > 0 
      ? courses.reduce((sum, course) => sum + course.averageGrade, 0) / courses.length 
      : 0;

    // Calculate GPA (4.0 scale)
    const gpaValues = courses.map(course => {
      const grade = course.averageGrade;
      if (grade >= 90) return 4.0;
      if (grade >= 80) return 3.0;
      if (grade >= 70) return 2.0;
      if (grade >= 60) return 1.0;
      return 0.0;
    });
    
    const overallGPA = gpaValues.length > 0 
      ? gpaValues.reduce((sum, gpa) => sum + gpa, 0) / gpaValues.length 
      : 0;

    const stats = {
      totalCourses,
      overallGPA: Math.round(overallGPA * 100) / 100,
      completedAssignments,
      totalAssignments,
      averagePercentage: Math.round(averagePercentage * 10) / 10
    };

    res.json({
      success: true,
      courses,
      stats
    });

  } catch (error) {
    console.error('Error fetching student grades:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch grades'
    });
  }
});

// 2. GET /api/student/courses/:courseId/grades - Get detailed assignment grades for a specific course
app.get('/api/student/courses/:courseId/grades', authenticateToken, async (req, res) => {
  try {
    const { courseId } = req.params;
    const studentId = req.user.id;

    // Verify student is enrolled in the course
    const enrollmentCheck = await db.query(
      'SELECT id FROM course_enrollments WHERE course_id = $1 AND student_id = $2 AND status = $3',
      [courseId, studentId, 'active']
    );

    if (enrollmentCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'You are not enrolled in this course'
      });
    }

    // Get assignments with submissions and grades
    const assignmentsQuery = `
      SELECT 
        a.id,
        a.course_id,
        a.title,
        a.description,
        a.instructions,
        a.assignment_type,
        a.assignment_group,
        a.grading_type,
        a.max_points,
        a.due_date,
        a.available_from,
        a.available_until,
        a.allowed_attempts,
        a.has_time_limit,
        a.time_limit_minutes,
        a.created_at,
        -- Submission details
        sub.id as submission_id,
        sub.score as earned_points,
        sub.submitted_at,
        sub.graded_at,
        sub.status,
        sub.feedback,
        sub.attempt_number,
        sub.time_started,
        sub.time_completed,
        sub.auto_submitted,
        -- Calculate percentage
        CASE 
          WHEN sub.score IS NOT NULL AND a.max_points > 0 THEN
            (sub.score::float / a.max_points::float) * 100
          ELSE NULL
        END as percentage,
        -- Calculate time spent (in minutes)
        CASE 
          WHEN sub.time_started IS NOT NULL AND sub.time_completed IS NOT NULL THEN
            EXTRACT(EPOCH FROM (sub.time_completed - sub.time_started)) / 60
          ELSE NULL
        END as time_spent_minutes
      FROM assignments a
      LEFT JOIN assignment_submissions sub ON a.id = sub.assignment_id 
        AND sub.student_id = $2
        AND sub.status IN ('submitted', 'graded', 'late')
      WHERE a.course_id = $1 
        AND a.is_published = true
      ORDER BY a.due_date ASC NULLS LAST, a.created_at ASC
    `;

    const assignmentsResult = await db.query(assignmentsQuery, [courseId, studentId]);

    const assignments = assignmentsResult.rows.map(row => {
      // Determine status based on submission and due date
      let status = 'missing';
      if (row.submission_id) {
        status = row.status;
        // Check if it was submitted late
        if (row.due_date && row.submitted_at && new Date(row.submitted_at) > new Date(row.due_date)) {
          status = 'late';
        }
      } else if (row.due_date && new Date() > new Date(row.due_date)) {
        status = 'missing';
      } else {
        status = 'draft'; // Assignment exists but not submitted yet
      }

      return {
        id: row.id,
        courseId: row.course_id,
        title: row.title,
        description: row.description,
        instructions: row.instructions,
        assignmentType: row.assignment_type,
        assignmentGroup: row.assignment_group,
        gradingType: row.grading_type,
        maxPoints: row.max_points,
        earnedPoints: row.earned_points,
        submittedAt: row.submitted_at,
        gradedAt: row.graded_at,
        dueDate: row.due_date,
        availableFrom: row.available_from,
        availableUntil: row.available_until,
        status: status,
        feedback: row.feedback,
        attemptNumber: row.attempt_number,
        timeSpent: row.time_spent_minutes ? Math.round(row.time_spent_minutes) : null,
        percentage: row.percentage ? Math.round(row.percentage * 10) / 10 : null,
        submissionId: row.submission_id,
        autoSubmitted: row.auto_submitted,
        allowedAttempts: row.allowed_attempts,
        hasTimeLimit: row.has_time_limit,
        timeLimitMinutes: row.time_limit_minutes
      };
    });

    res.json({
      success: true,
      assignments
    });

  } catch (error) {
    console.error('Error fetching course assignments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch course assignments'
    });
  }
});

// 3. GET /api/student/assignment/:assignmentId/review - Get assignment details for review
app.get('/api/student/assignment/:assignmentId/review', authenticateToken, async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const studentId = req.user.id;

    // Get assignment details with submission
    const query = `
      SELECT 
        a.*,
        c.title as course_title,
        c.code as course_code,
        sub.id as submission_id,
        sub.score,
        sub.submitted_at,
        sub.graded_at,
        sub.status,
        sub.feedback,
        sub.content as submission_content,
        sub.file_url,
        sub.quiz_data,
        sub.attempt_number,
        sub.time_started,
        sub.time_completed,
        -- Get instructor info
        u.first_name as instructor_first_name,
        u.last_name as instructor_last_name
      FROM assignments a
      JOIN courses c ON a.course_id = c.id
      JOIN users u ON c.instructor_id = u.id
      LEFT JOIN assignment_submissions sub ON a.id = sub.assignment_id AND sub.student_id = $2
      WHERE a.id = $1
    `;

    const result = await db.query(query, [assignmentId, studentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    const assignment = result.rows[0];

    // For quizzes, get questions and answers
    let questions = [];
    if (assignment.assignment_type === 'quiz' && assignment.submission_id) {
      const questionsQuery = `
        SELECT 
          q.id,
          q.question_number,
          q.title,
          q.question_text,
          q.question_type,
          q.points,
          q.image_url,
          -- Get all possible answers
          json_agg(
            json_build_object(
              'id', qa.id,
              'answer_text', qa.answer_text,
              'is_correct', qa.is_correct,
              'feedback', qa.feedback,
              'answer_order', qa.answer_order
            ) ORDER BY qa.answer_order
          ) as answers
        FROM quiz_questions q
        LEFT JOIN quiz_question_answers qa ON q.id = qa.question_id
        WHERE q.assignment_id = $1
        GROUP BY q.id, q.question_number, q.title, q.question_text, q.question_type, q.points, q.image_url
        ORDER BY q.question_number
      `;

      const questionsResult = await db.query(questionsQuery, [assignmentId]);
      questions = questionsResult.rows;
    }

    const reviewData = {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        instructions: assignment.instructions,
        assignmentType: assignment.assignment_type,
        maxPoints: assignment.max_points,
        dueDate: assignment.due_date,
        course: {
          title: assignment.course_title,
          code: assignment.course_code
        },
        instructor: {
          firstName: assignment.instructor_first_name,
          lastName: assignment.instructor_last_name
        }
      },
      submission: assignment.submission_id ? {
        id: assignment.submission_id,
        score: assignment.score,
        submittedAt: assignment.submitted_at,
        gradedAt: assignment.graded_at,
        status: assignment.status,
        feedback: assignment.feedback,
        content: assignment.submission_content,
        fileUrl: assignment.file_url,
        quizData: assignment.quiz_data,
        attemptNumber: assignment.attempt_number,
        timeStarted: assignment.time_started,
        timeCompleted: assignment.time_completed,
        percentage: assignment.score && assignment.max_points ? 
          Math.round((assignment.score / assignment.max_points) * 1000) / 10 : null
      } : null,
      questions: questions
    };

    res.json({
      success: true,
      data: reviewData
    });

  } catch (error) {
    console.error('Error fetching assignment review:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assignment review'
    });
  }
});

// Helper function to calculate letter grade
function calculateLetterGrade(percentage) {
  if (percentage >= 90) return 'A';
  if (percentage >= 80) return 'B';
  if (percentage >= 70) return 'C';
  if (percentage >= 60) return 'D';
  return 'F';
}

// Export for use in your Express app
module.exports = {
};