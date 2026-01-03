// controllers/teacherReview.controller.js
import { validationResult } from 'express-validator';
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

// Helper function to calculate letter grade
const calculateLetterGrade = (percentage) => {
  if (percentage >= 97) return 'A+';
  if (percentage >= 93) return 'A';
  if (percentage >= 90) return 'A-';
  if (percentage >= 87) return 'B+';
  if (percentage >= 83) return 'B';
  if (percentage >= 80) return 'B-';
  if (percentage >= 77) return 'C+';
  if (percentage >= 73) return 'C';
  if (percentage >= 70) return 'C-';
  if (percentage >= 67) return 'D+';
  if (percentage >= 63) return 'D';
  if (percentage >= 60) return 'D-';
  return 'F';
};

// Helper function to determine performance level
const getPerformanceLevel = (percentage) => {
  if (percentage >= 90) return 'excellent';
  if (percentage >= 80) return 'good';
  if (percentage >= 70) return 'average';
  if (percentage >= 60) return 'below_average';
  return 'needs_attention';
};

/**
 * Get detailed assessment review data for teachers
 */

export const getAssessmentReview = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(createErrorResponse('Validation failed', errors.array()));
    }

    console.log("req.params , ",req.params);

    const { assessmentId } = req.params;
    const teacherId = "871ed189-c7f7-44e1-8cdd-adeecea39cea";

    console.log(`Fetching assessment review for teacher: ${teacherId}, assessment: ${assessmentId}`);

    // 1. Verify the teacher has access to this assessment
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select(`
        id,
        title,
        description,
        assignment_type,
        max_points,
        due_date,
        available_from,
        available_until,
        is_published,
        allowed_attempts,
        has_time_limit,
        time_limit_minutes,
        show_correct_answers,
        shuffle_answers,
        one_question_at_time,
        cant_go_back,
        created_at,
        updated_at,
        course_id,
        courses!inner (
          id,
          title,
          code,
          description,
          instructor_id
        )
      `)
      .eq('id', assessmentId)
      .eq('courses.instructor_id', teacherId)
      .single();

    if (assignmentError || !assignment) {
      console.error('Error fetching assignment or unauthorized access:', assignmentError);
      return res.status(404).json(createErrorResponse('Assignment not found or access denied'));
    }

    const course = assignment.courses;

    // 2. Get all questions and their answers/options for this assessment (if it's a quiz)
    let questions = [];
    let correctAnswersMap = {};
    let shortAnswerOptionsMap = {};

    if (assignment.assignment_type === 'quiz') {
      // Fetch questions with multiple choice answers
      const { data: questionsData, error: questionsError } = await supabase
        .from('quiz_questions')
        .select(`
          id,
          question_number,
          title,
          question_text,
          question_type,
          points,
          image_url,
          short_answer_match_type,
          short_answer_case_sensitive,
          quiz_question_answers (
            id,
            answer_text,
            is_correct,
            feedback,
            answer_order
          )
        `)
        .eq('assignment_id', assessmentId)
        .order('question_number', { ascending: true });

      if (questionsError) {
        console.error('Error fetching questions:', questionsError);
        return res.status(500).json(createErrorResponse('Failed to fetch quiz questions'));
      }

      // Fetch short answer options separately
      const { data: shortAnswerOptions, error: shortAnswerError } = await supabase
        .from('quiz_short_answer_options')
        .select(`
          id,
          question_id,
          answer_text,
          is_case_sensitive,
          is_exact_match,
          answer_order
        `)
        .in('question_id', questionsData.map(q => q.id))
        .order('answer_order', { ascending: true });

      if (shortAnswerError) {
        console.error('Error fetching short answer options:', shortAnswerError);
      }

      // Organize short answer options by question ID
      if (shortAnswerOptions) {
        shortAnswerOptions.forEach(option => {
          if (!shortAnswerOptionsMap[option.question_id]) {
            shortAnswerOptionsMap[option.question_id] = [];
          }
          shortAnswerOptionsMap[option.question_id].push(option);
        });
      }

      if (questionsData) {
        questions = questionsData.map(q => ({
          id: q.id,
          questionNumber: q.question_number,
          title: q.title,
          questionText: q.question_text,
          questionType: q.question_type,
          points: q.points,
          imageUrl: q.image_url,
          shortAnswerMatchType: q.short_answer_match_type,
          shortAnswerCaseSensitive: q.short_answer_case_sensitive,
          answers: q.quiz_question_answers
            .sort((a, b) => a.answer_order - b.answer_order)
            .map(answer => ({
              id: answer.id,
              answerText: answer.answer_text,
              isCorrect: answer.is_correct,
              feedback: answer.feedback,
              answerOrder: answer.answer_order
            })),
          shortAnswerOptions: shortAnswerOptionsMap[q.id] || []
        }));

        // Create a map of correct answers for quick lookup
        questions.forEach(question => {
          if (question.questionType === 'multiple_choice' || question.questionType === 'true_false') {
            const correctAnswer = question.answers.find(a => a.isCorrect);
            if (correctAnswer) {
              correctAnswersMap[question.id] = correctAnswer.id;
            }
          }
        });
      }
    }

    // Helper function to grade short answer
    const gradeShortAnswer = (studentAnswer, acceptableAnswers, matchType = 'exact', caseSensitive = false) => {
      if (!studentAnswer || !acceptableAnswers || acceptableAnswers.length === 0) {
        return false;
      }

      let cleanStudentAnswer = studentAnswer.trim();

      for (const acceptable of acceptableAnswers) {
        let cleanAcceptableAnswer = acceptable.answer_text.trim();

        // Handle case sensitivity
        if (!caseSensitive && !acceptable.is_case_sensitive) {
          cleanStudentAnswer = cleanStudentAnswer.toLowerCase();
          cleanAcceptableAnswer = cleanAcceptableAnswer.toLowerCase();
        }

        // Check match type
        const isExactMatch = acceptable.is_exact_match !== undefined ? acceptable.is_exact_match : (matchType === 'exact');

        if (isExactMatch) {
          if (cleanStudentAnswer === cleanAcceptableAnswer) {
            return true;
          }
        } else {
          if (cleanStudentAnswer.includes(cleanAcceptableAnswer) || cleanAcceptableAnswer.includes(cleanStudentAnswer)) {
            return true;
          }
        }
      }

      return false;
    };

    // 3. Get all enrolled students in the course
    console.log('Fetching enrollments for course ID:', course.id);

    const { data: enrollments, error: enrollmentError } = await supabase
      .from('course_enrollments')
      .select(`
        student_id,
        enrolled_at,
        status,
        final_score,
        grade,
        users!inner (
          id,
          first_name,
          last_name,
          email,
          avatar_url
        )
      `)
      .eq('course_id', course.id)
      .eq('status', 'active');

    if (enrollmentError) {
      console.error('Error fetching enrollments for course', course.id, ':', enrollmentError);
      return res.status(500).json(createErrorResponse(`Failed to fetch student enrollment data: ${enrollmentError.message || 'Unknown error'}`));
    }

    console.log('Enrollments found:', enrollments?.length || 0);

    // Sort the enrollments by student last name
    if (enrollments && enrollments.length > 0) {
      enrollments.sort((a, b) => {
        const lastNameA = a.users?.last_name || '';
        const lastNameB = b.users?.last_name || '';
        return lastNameA.localeCompare(lastNameB);
      });
    }

    if (!enrollments || enrollments.length === 0) {
      return res.json(createSuccessResponse({
        assignment: {
          id: assignment.id,
          title: assignment.title,
          description: assignment.description,
          type: assignment.assignment_type,
          maxPoints: assignment.max_points,
          dueDate: assignment.due_date,
          createdAt: assignment.created_at
        },
        course: {
          id: course.id,
          title: course.title,
          code: course.code
        },
        questions: questions,
        studentReviews: [],
        statistics: {
          totalStudents: 0,
          submittedCount: 0,
          gradedCount: 0,
          averageScore: 0,
          completionRate: 0
        }
      }, 'No enrolled students found'));
    }

    // 4. Get all submissions for this assessment from enrolled students
    const studentIds = enrollments.map(e => e.student_id);

    console.log('Fetching submissions for', studentIds.length, 'students');

    const { data: submissions, error: submissionError } = await supabase
      .from('assignment_submissions')
      .select(`
        id,
        assignment_id,
        student_id,
        status,
        score,
        submitted_at,
        graded_at,
        attempt_number,
        feedback,
        quiz_data,
        content,
        file_url,
        time_started,
        time_completed,
        auto_submitted,
        graded_by
      `)
      .eq('assignment_id', assessmentId)
      .in('student_id', studentIds)
      .order('student_id')
      .order('attempt_number', { ascending: false });

    if (submissionError) {
      console.error('Error fetching submissions:', submissionError);
      return res.status(500).json(createErrorResponse('Failed to fetch submission data'));
    }

    console.log('Submissions found:', submissions?.length || 0);

    // Calculate time spent
    const processedSubmissions = submissions?.map(sub => {
      let timeSpentMinutes = null;
      if (sub.time_started && sub.time_completed) {
        const startTime = new Date(sub.time_started);
        const endTime = new Date(sub.time_completed);
        const diffMs = endTime - startTime;
        timeSpentMinutes = Math.round(diffMs / (1000 * 60));
      }

      return {
        ...sub,
        time_spent_minutes: timeSpentMinutes
      };
    }) || [];

    // 5. Process submissions - get best/latest per student
    const submissionMap = {};
    const allSubmissionsMap = {};

    processedSubmissions.forEach(sub => {
      if (!allSubmissionsMap[sub.student_id]) {
        allSubmissionsMap[sub.student_id] = [];
      }
      allSubmissionsMap[sub.student_id].push(sub);

      if (!submissionMap[sub.student_id]) {
        submissionMap[sub.student_id] = sub;
      } else {
        const existing = submissionMap[sub.student_id];
        if (sub.status === 'graded' && existing.status !== 'graded') {
          submissionMap[sub.student_id] = sub;
        } else if (sub.status === existing.status) {
          if (sub.score !== null && existing.score !== null) {
            if (sub.score > existing.score) {
              submissionMap[sub.student_id] = sub;
            }
          } else if (sub.score !== null && existing.score === null) {
            submissionMap[sub.student_id] = sub;
          } else if (new Date(sub.submitted_at) > new Date(existing.submitted_at)) {
            submissionMap[sub.student_id] = sub;
          }
        }
      }
    });

    // 6. Process student data with detailed answers
    const studentReviews = [];
    let totalScore = 0;
    let scoredSubmissions = 0;
    let submittedCount = 0;
    let gradedCount = 0;
    const now = new Date();
    const dueDate = assignment.due_date ? new Date(assignment.due_date) : null;

    enrollments.forEach(enrollment => {
      const student = enrollment.users;
      const bestSubmission = submissionMap[student.id];
      const allAttempts = allSubmissionsMap[student.id] || [];

      let studentAnswers = null;
      let answerAnalysis = null;
      let status = 'not_submitted';
      let percentage = null;
      let earnedPoints = null;

      if (bestSubmission) {
        if (bestSubmission.status === 'graded') {
          status = 'graded';
          gradedCount++;
        } else if (bestSubmission.status === 'submitted') {
          status = 'submitted';
          submittedCount++;
        }

        earnedPoints = bestSubmission.score;

        // Parse quiz answers if available
        if (bestSubmission.quiz_data && assignment.assignment_type === 'quiz') {
          try {
            const quizData = typeof bestSubmission.quiz_data === 'string' ?
              JSON.parse(bestSubmission.quiz_data) : bestSubmission.quiz_data;

            studentAnswers = quizData.answers || quizData;

            // Analyze answers against correct answers
            answerAnalysis = {};
            let correctCount = 0;
            let totalQuestions = questions.length;
            let totalPointsEarned = 0;
            let totalPossiblePoints = 0;

            // Fix the answer analysis logic to handle essay questions properly
            questions.forEach(question => {
              const studentAnswer = studentAnswers[question.id];
              totalPossiblePoints += question.points;
              let isCorrect = false;
              let pointsEarned = 0;
              let studentAnswerText = 'No answer provided';
              let correctAnswerText = 'No correct answer';

              if (studentAnswer) {
                if (question.questionType === 'multiple_choice' || question.questionType === 'true_false') {
                  // Handle multiple choice and true/false
                  const correctAnswerId = correctAnswersMap[question.id];

                  if (studentAnswer.answerId) {
                    isCorrect = studentAnswer.answerId === correctAnswerId;

                    const selectedAnswer = question.answers.find(a => a.id === studentAnswer.answerId);
                    const correctAnswer = question.answers.find(a => a.isCorrect);

                    studentAnswerText = selectedAnswer?.answerText || 'Answer not found';
                    correctAnswerText = correctAnswer?.answerText || 'No correct answer';
                  }
                } else if (question.questionType === 'short_answer') {
                  // Handle short answer questions
                  if (studentAnswer.textAnswer) {
                    studentAnswerText = studentAnswer.textAnswer;

                    // Get acceptable answers for this question
                    const acceptableAnswers = question.shortAnswerOptions || [];

                    if (acceptableAnswers.length > 0) {
                      isCorrect = gradeShortAnswer(
                        studentAnswer.textAnswer,
                        acceptableAnswers,
                        question.shortAnswerMatchType,
                        question.shortAnswerCaseSensitive
                      );

                      // Show all acceptable answers
                      correctAnswerText = acceptableAnswers
                        .map(option => option.answer_text)
                        .join(', ');
                    }
                  }

                  // Replace the essay question handling section (around lines 180-190) with this:

                } else if (question.questionType === 'essay') {
                  // Handle essay questions
                  if (studentAnswer.textAnswer) {
                    studentAnswerText = studentAnswer.textAnswer;
                    correctAnswerText = 'Requires manual grading';

                    // Check if this essay has been manually graded
                    // Look for saved points in the quiz_data structure
                    if (studentAnswer.pointsEarned !== undefined && studentAnswer.pointsEarned !== null) {
                      // Points were saved directly in the answer object
                      pointsEarned = studentAnswer.pointsEarned;
                      isCorrect = pointsEarned > 0;
                      totalPointsEarned += pointsEarned;
                    } else if (quizData.detailedResults && quizData.detailedResults[question.id]) {
                      // Points might be saved in detailedResults
                      const detailedResult = quizData.detailedResults[question.id];
                      if (detailedResult.points !== undefined && detailedResult.points !== null) {
                        pointsEarned = detailedResult.points;
                        isCorrect = pointsEarned > 0;
                        totalPointsEarned += pointsEarned;
                      }
                    }

                    // Mark as graded if points have been assigned or if explicitly marked as graded
                    const isGraded = studentAnswer.isGraded ||
                      (quizData.detailedResults && quizData.detailedResults[question.id] && quizData.detailedResults[question.id].isGraded) ||
                      (pointsEarned !== undefined && pointsEarned !== null);
                  }
                }

                if (isCorrect) {
                  correctCount++;
                  pointsEarned = question.points;
                  totalPointsEarned += question.points;
                }
              }

              // Replace the answerAnalysis assignment (around line 200-210) with this:

              answerAnalysis[question.id] = {
                questionNumber: question.questionNumber,
                questionText: question.questionText,
                questionPoints: question.points,
                studentAnswerId: studentAnswer?.answerId || null,
                studentAnswerText: studentAnswerText,
                correctAnswerText: correctAnswerText,
                isCorrect: isCorrect,
                pointsEarned: pointsEarned,
                feedback: studentAnswer?.feedback || null,
                // Add grading information for essay questions
                isGraded: question.questionType === 'essay' ? (
                  studentAnswer?.isGraded ||
                  (quizData.detailedResults && quizData.detailedResults[question.id] && quizData.detailedResults[question.id].isGraded) ||
                  (pointsEarned !== undefined && pointsEarned !== null)
                ) : true // Non-essay questions are considered auto-graded
              };
            });
            // Always use the recalculated points from analysis for quiz submissions
            // This ensures we use the correct auto-graded score
            earnedPoints = totalPointsEarned;

            // Calculate percentage based on analysis
            if (totalPossiblePoints > 0) {
              percentage = Math.round((earnedPoints / totalPossiblePoints) * 100);
            }
          } catch (error) {
            console.error('Error parsing quiz data for student:', student.id, error);
          }
        }

        // Track statistics - always use recalculated earnedPoints for quizzes
        if (earnedPoints !== null && earnedPoints !== undefined) {
          totalScore += earnedPoints;
          scoredSubmissions++;

          // Calculate percentage based on actual earned points, not stored score
          if (!percentage && assignment.max_points > 0) {
            percentage = Math.round((earnedPoints / assignment.max_points) * 100);
          }
        }
      } else {
        // Student hasn't submitted - check if overdue
        if (dueDate && dueDate < now) {
          status = 'missing';
        }
      }

      studentReviews.push({
        student: {
          id: student.id,
          name: `${student.first_name} ${student.last_name}`.trim() || 'Unknown',
          firstName: student.first_name,
          lastName: student.last_name,
          email: student.email,
          avatarUrl: student.avatar_url,
          enrolledAt: enrollment.enrolled_at
        },
        submission: bestSubmission ? {
          id: bestSubmission.id,
          status: bestSubmission.status,
          score: earnedPoints,
          percentage: percentage,
          letterGrade: percentage !== null ? calculateLetterGrade(percentage) : null,
          performanceLevel: percentage !== null ? getPerformanceLevel(percentage) : 'not_attempted',
          submittedAt: bestSubmission.submitted_at,
          gradedAt: bestSubmission.graded_at,
          gradedBy: bestSubmission.graded_by,
          attemptNumber: bestSubmission.attempt_number,
          totalAttempts: allAttempts.length,
          timeSpentMinutes: bestSubmission.time_spent_minutes,
          feedback: bestSubmission.feedback,
          content: bestSubmission.content,
          fileUrl: bestSubmission.file_url,
          autoSubmitted: bestSubmission.auto_submitted
        } : null,
        answers: answerAnalysis,
        allAttempts: allAttempts.map(attempt => ({
          id: attempt.id,
          attemptNumber: attempt.attempt_number,
          status: attempt.status,
          score: attempt.score,
          percentage: attempt.score && assignment.max_points > 0 ?
            Math.round((attempt.score / assignment.max_points) * 100) : null,
          submittedAt: attempt.submitted_at,
          gradedAt: attempt.graded_at,
          timeSpentMinutes: attempt.time_spent_minutes,
          feedback: attempt.feedback
        })),
        status: status
      });
    });

    // 7. Calculate overall statistics
    const totalStudents = enrollments.length;
    const notSubmittedCount = totalStudents - submittedCount - gradedCount;
    const completionRate = totalStudents > 0 ?
      Math.round(((submittedCount + gradedCount) / totalStudents) * 100) : 0;

    const averageScore = scoredSubmissions > 0 ?
      Math.round(totalScore / scoredSubmissions) : 0;

    const averagePercentage = assignment.max_points > 0 && scoredSubmissions > 0 ?
      Math.round((totalScore / scoredSubmissions / assignment.max_points) * 100) : 0;

    // Grade distribution
    const gradeDistribution = {
      'A': 0, 'B': 0, 'C': 0, 'D': 0, 'F': 0, 'Not Graded': 0
    };

    studentReviews.forEach(review => {
      if (review.submission && review.submission.letterGrade) {
        const firstLetter = review.submission.letterGrade.charAt(0);
        if (gradeDistribution.hasOwnProperty(firstLetter)) {
          gradeDistribution[firstLetter]++;
        }
      } else {
        gradeDistribution['Not Graded']++;
      }
    });

    console.log(`Processed ${totalStudents} students with ${processedSubmissions.length || 0} total submissions`);

    const validScores = studentReviews
      .filter(r => r.submission && r.submission.score !== null && r.submission.score !== undefined)
      .map(r => r.submission.score);

    res.json(createSuccessResponse({
      assignment: {
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        type: assignment.assignment_type,
        maxPoints: assignment.max_points,
        dueDate: assignment.due_date,
        availableFrom: assignment.available_from,
        availableUntil: assignment.available_until,
        isPublished: assignment.is_published,
        allowedAttempts: assignment.allowed_attempts,
        hasTimeLimit: assignment.has_time_limit,
        timeLimitMinutes: assignment.time_limit_minutes,
        showCorrectAnswers: assignment.show_correct_answers,
        shuffleAnswers: assignment.shuffle_answers,
        oneQuestionAtTime: assignment.one_question_at_time,
        cantGoBack: assignment.cant_go_back,
        createdAt: assignment.created_at,
        updatedAt: assignment.updated_at
      },
      course: {
        id: course.id,
        title: course.title,
        code: course.code,
        description: course.description
      },
      questions: questions,
      studentReviews: studentReviews,
      statistics: {
        totalStudents,
        submittedCount,
        gradedCount,
        notSubmittedCount,
        averageScore,
        averagePercentage,
        completionRate,
        totalSubmissions: processedSubmissions.length,
        gradeDistribution,
        highestScore: validScores.length > 0 ? Math.max(...validScores) : 0,
        lowestScore: validScores.length > 0 ? Math.min(...validScores) : 0
      },
      lastUpdated: new Date().toISOString()
    }, 'Assessment review data retrieved successfully'));

  } catch (error) {
    console.error('Error in getAssessmentReview:', error);
    res.status(500).json(createErrorResponse('Failed to fetch assessment review data'));
  }
};

/**
 * Get detailed review for a specific student's submission
 */
export const getStudentSubmissionReview = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(createErrorResponse('Validation failed', errors.array()));
    }

    const { assessmentId, studentId } = req.params;
    const teacherId = req.user.id;

    console.log(`Fetching student submission review - Teacher: ${teacherId}, Assessment: ${assessmentId}, Student: ${studentId}`);

    // Verify teacher access to assessment
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select(`
        id,
        title,
        max_points,
        courses!inner (
          id,
          title,
          instructor_id
        )
      `)
      .eq('id', assessmentId)
      .eq('courses.instructor_id', teacherId)
      .single();

    if (assignmentError || !assignment) {
      return res.status(404).json(createErrorResponse('Assignment not found or access denied'));
    }

    res.json(createSuccessResponse({
      assignment: {
        id: assignment.id,
        title: assignment.title
      },
      message: 'Student submission review retrieved successfully'
    }));

  } catch (error) {
    console.error('Error fetching student submission:', error);
    res.status(500).json(createErrorResponse('Failed to fetch student submission'));
  }
};

/**
 * Grade or update grade for a student submission
 */
export const gradeSubmission = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(createErrorResponse('Validation failed', errors.array()));
    }

    const { assessmentId } = req.params;
    const { studentId, score, feedback } = req.body;
    const teacherId = req.user.id;

    console.log(`Grading submission - Teacher: ${teacherId}, Assessment: ${assessmentId}, Student: ${studentId}`);

    // Verify teacher has access to this assessment
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select(`
        id,
        max_points,
        courses!inner (instructor_id)
      `)
      .eq('id', assessmentId)
      .eq('courses.instructor_id', teacherId)
      .single();

    if (assignmentError || !assignment) {
      return res.status(404).json(createErrorResponse('Assignment not found or access denied'));
    }

    // Validate score
    if (score < 0 || score > assignment.max_points) {
      return res.status(400).json(createErrorResponse(
        `Score must be between 0 and ${assignment.max_points}`
      ));
    }

    res.json(createSuccessResponse({
      message: 'Grade would be updated successfully',
      score: score,
      feedback: feedback
    }));

  } catch (error) {
    console.error('Error updating grade:', error);
    res.status(500).json(createErrorResponse('Failed to update grade'));
  }
};

/**
 * Get assessment statistics and analytics
 */
export const getAssessmentStatistics = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(createErrorResponse('Validation failed', errors.array()));
    }

    const { assessmentId } = req.params;
    const teacherId = req.user.id;

    console.log(`Fetching assessment statistics - Teacher: ${teacherId}, Assessment: ${assessmentId}`);

    res.json(createSuccessResponse({
      message: 'Assessment statistics retrieved successfully',
      assessmentId: assessmentId
    }));

  } catch (error) {
    console.error('Error in getAssessmentStatistics:', error);
    res.status(500).json(createErrorResponse('Failed to fetch assessment statistics'));
  }
};

/**
 * Export assessment results
 */
export const exportAssessmentResults = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const { format = 'csv' } = req.query;
    const teacherId = req.user.id;

    console.log(`Exporting assessment results - Teacher: ${teacherId}, Assessment: ${assessmentId}, Format: ${format}`);

    res.json(createSuccessResponse({
      message: 'Export functionality coming soon',
      format: format,
      assessmentId: assessmentId
    }));

  } catch (error) {
    console.error('Error exporting assessment results:', error);
    res.status(500).json(createErrorResponse('Failed to export assessment results'));
  }
};

export default {
  getAssessmentReview,
  getStudentSubmissionReview,
  gradeSubmission,
  getAssessmentStatistics,
  exportAssessmentResults
};