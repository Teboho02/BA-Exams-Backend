// controllers/assignment.controller.js
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

// Helper function to sanitize assignment data
const sanitizeAssignment = (assignment) => ({
  id: assignment.id,
  courseId: assignment.course_id,
  title: assignment.title,
  description: assignment.description,
  instructions: assignment.instructions,
  assignmentType: assignment.assignment_type,
  assignmentGroup: assignment.assignment_group,
  gradingType: assignment.grading_type,
  maxPoints: assignment.max_points,
  isPublished: assignment.is_published,
  submissionType: assignment.submission_type,
  submissionTypes: assignment.submission_types,
  dueDate: assignment.due_date,
  availableFrom: assignment.available_from,
  availableUntil: assignment.available_until,
  allowedAttempts: assignment.allowed_attempts,
  hasTimeLimit: assignment.has_time_limit,
  timeLimitMinutes: assignment.time_limit_minutes,
  shuffleAnswers: assignment.shuffle_answers,
  showCorrectAnswers: assignment.show_correct_answers,
  oneQuestionAtTime: assignment.one_question_at_time,
  cantGoBack: assignment.cant_go_back,
  requireAccessCode: assignment.require_access_code,
  accessCode: assignment.access_code,
  password: assignment.password,
  ipFiltering: assignment.ip_filtering,
  ipFilter: assignment.ip_filter,
  notifyOfUpdate: assignment.notify_of_update,
  quizInstructions: assignment.quiz_instructions,
  createdAt: assignment.created_at,
  updatedAt: assignment.updated_at
});

// Helper function to sanitize question data
const sanitizeQuestion = (question) => ({
  id: question.id,
  assignmentId: question.assignment_id,
  questionNumber: question.question_number,
  title: question.title,
  questionText: question.question_text,
  questionType: question.question_type,
  points: question.points,
  imageUrl: question.image_url,
  createdAt: question.created_at,
  updatedAt: question.updated_at
});

// Helper function to sanitize answer data
const sanitizeAnswer = (answer) => ({
  id: answer.id,
  questionId: answer.question_id,
  answerText: answer.answer_text,
  isCorrect: answer.is_correct,
  feedback: answer.feedback,
  answerOrder: answer.answer_order,
  createdAt: answer.created_at
});



export const createAssignment = async (req, res) => {
  try {
    const {
      courseId,
      title,
      description,
      assignmentType,
      assignmentGroup,
      gradingType,
      maxPoints,
      submissionType,
      submissionTypes,
      dueDate,
      availableFrom,
      availableUntil,
      allowedAttempts,
      hasTimeLimit,
      timeLimitMinutes,
      shuffleAnswers,
      showCorrectAnswers,
      oneQuestionAtTime,
      cantGoBack,
      requireAccessCode,
      accessCode,
      password,
      ipFiltering,
      ipFilter,
      published,
      is_published,
      instructions,
      quizInstructions,
      questions
    } = req.body;

    const userId = req.user.id;

    // Validation
    if (!courseId || !title || !assignmentType) {
      return res.status(400).json(createErrorResponse('Missing required fields'));
    }

    // Verify the user is the instructor of the course
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('id, instructor_id')
      .eq('id', courseId)
      .single();

    if (courseError || !course) {
      return res.status(404).json(createErrorResponse('Course not found'));
    }

    // Check if user is instructor or has teaching assignment
    const { data: teachingAssignment } = await supabase
      .from('teaching_assignments')
      .select('id')
      .eq('course_id', courseId)
      .eq('teacher_id', userId)
      .single();

    if (course.instructor_id !== userId && !teachingAssignment) {
      return res.status(403).json(createErrorResponse('Not authorized to create assignments for this course'));
    }

    // For quiz type, calculate total points from questions
    let calculatedMaxPoints = maxPoints || 100;
    if (assignmentType === 'quiz' && questions && questions.length > 0) {
      calculatedMaxPoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);
    }

    // Prepare submission types
    let finalSubmissionTypes = submissionTypes;
    if (assignmentType === 'quiz') {
      finalSubmissionTypes = ['online_quiz'];
    } else if (typeof submissionTypes === 'string') {
      finalSubmissionTypes = [submissionTypes];
    } else if (!Array.isArray(submissionTypes)) {
      finalSubmissionTypes = ['file'];
    }

    // Create the assignment
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .insert({
        course_id: courseId,
        title: title.trim(),
        description: description || '',
        instructions: instructions || quizInstructions || '',
        due_date: dueDate || null,
        max_points: calculatedMaxPoints,
        is_published: published || is_published || false,
        submission_type: assignmentType === 'quiz' ? 'online_quiz' : (submissionType || 'file'),
        submission_types: finalSubmissionTypes,
        assignment_type: assignmentType || 'assignment',
        assignment_group: assignmentGroup || 'assignments',
        grading_type: gradingType || 'points',
        available_from: availableFrom || null,
        available_until: availableUntil || null,
        allowed_attempts: allowedAttempts || 1,
        has_time_limit: hasTimeLimit || false,
        time_limit_minutes: hasTimeLimit ? (timeLimitMinutes || null) : null,
        shuffle_answers: shuffleAnswers || false,
        show_correct_answers: showCorrectAnswers !== false, // Default to true
        one_question_at_time: oneQuestionAtTime || false,
        cant_go_back: cantGoBack || false,
        require_access_code: requireAccessCode || !!accessCode || !!password,
        access_code: accessCode || password || null,
        password: password || accessCode || null,
        ip_filtering: ipFiltering || false,
        ip_filter: ipFilter || null,
        quiz_instructions: quizInstructions || instructions || ''
      })
      .select()
      .single();

    if (assignmentError) {
      console.error('Assignment creation error:', assignmentError);
      return res.status(400).json(createErrorResponse('Failed to create assignment'));
    }

    // If it's a quiz with questions, create the questions
    if (assignmentType === 'quiz' && questions && questions.length > 0) {
      for (let questionIndex = 0; questionIndex < questions.length; questionIndex++) {
        const question = questions[questionIndex];
        
        // Validate question
        if (!question.questionText || !question.questionType) {
          console.error(`Invalid question at index ${questionIndex}:`, question);
          continue;
        }

        // Create the question
        const { data: createdQuestion, error: questionError } = await supabase
          .from('quiz_questions')
          .insert({
            assignment_id: assignment.id,
            question_number: questionIndex + 1,
            title: question.title || `Question ${questionIndex + 1}`,
            question_text: question.questionText,
            question_type: question.questionType,
            points: question.points || 1,
            image_url: question.imageUrl || null,
            // Add short answer specific columns
            short_answer_match_type: question.questionType === 'short_answer' ? (question.matchType || 'exact') : null,
            short_answer_case_sensitive: question.questionType === 'short_answer' ? (question.caseSensitive || false) : null
          })
          .select()
          .single();

        if (questionError) {
          console.error('Error creating question:', questionError);
          continue;
        }

        // Handle different question types
        if (question.questionType === 'multiple_choice' || question.questionType === 'true_false') {
          // Insert multiple choice/true-false answers
          if (question.answers && question.answers.length > 0) {
            const answersToInsert = question.answers.map((answer, index) => ({
              question_id: createdQuestion.id,
              answer_text: answer.text || '',
              is_correct: answer.correct || false,
              feedback: answer.feedback || '',
              answer_order: index + 1
            }));

            const { error: answersError } = await supabase
              .from('quiz_question_answers')
              .insert(answersToInsert);

            if (answersError) {
              console.error('Error creating answers for question:', answersError);
            }
          }
        } else if (question.questionType === 'short_answer') {
          // Insert acceptable short answers
          if (question.acceptableAnswers && question.acceptableAnswers.length > 0) {
            const acceptableAnswersToInsert = question.acceptableAnswers
              .filter(answer => answer && answer.trim()) // Only non-empty answers
              .map((answer, index) => ({
                question_id: createdQuestion.id,
                answer_text: answer.trim(),
                is_case_sensitive: question.caseSensitive || false,
                is_exact_match: question.matchType !== 'contains', // exact or regex both use exact_match = true
                answer_order: index + 1
              }));

            if (acceptableAnswersToInsert.length > 0) {
              const { error: shortAnswerError } = await supabase
                .from('quiz_short_answer_options')
                .insert(acceptableAnswersToInsert);

              if (shortAnswerError) {
                console.error('Error creating short answer options:', shortAnswerError);
              }
            }
          }
        }
        // For 'essay' and 'file_upload' types, no additional data needs to be stored
      }
    }

    // Fetch the complete assignment with questions if it's a quiz
    let completeAssignment = assignment;
    if (assignmentType === 'quiz') {
      const { data: questionsData } = await supabase
        .from('quiz_questions')
        .select(`
          *,
          quiz_question_answers(*)
        `)
        .eq('assignment_id', assignment.id)
        .order('question_number');

      // For short answer questions, also fetch acceptable answers
      if (questionsData && questionsData.length > 0) {
        const shortAnswerQuestions = questionsData.filter(q => q.question_type === 'short_answer');
        
        for (const saQuestion of shortAnswerQuestions) {
          const { data: shortAnswerOptions } = await supabase
            .from('quiz_short_answer_options')
            .select('*')
            .eq('question_id', saQuestion.id)
            .order('answer_order');
          
          saQuestion.quiz_short_answer_options = shortAnswerOptions || [];
        }
      }

      completeAssignment = {
        ...assignment,
        questions: questionsData || []
      };
    }

    res.status(201).json(createSuccessResponse({
      assignment: completeAssignment,
      message: `${assignmentType === 'quiz' ? 'Quiz' : 'Assignment'} created successfully`
    }));

  } catch (error) {
    console.error('Create assignment error:', error);
    res.status(500).json(createErrorResponse('Failed to create assignment'));
  }
};

// Update assignment function (similar structure but with UPDATE operations)
export const updateAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const {
      title,
      description,
      assignmentType,
      assignmentGroup,
      gradingType,
      maxPoints,
      submissionType,
      submissionTypes,
      dueDate,
      availableFrom,
      availableUntil,
      allowedAttempts,
      hasTimeLimit,
      timeLimitMinutes,
      shuffleAnswers,
      showCorrectAnswers,
      oneQuestionAtTime,
      cantGoBack,
      requireAccessCode,
      accessCode,
      password,
      ipFiltering,
      ipFilter,
      published,
      is_published,
      instructions,
      quizInstructions,
      questions
    } = req.body;

    const userId = req.user.id;

    // Get existing assignment
    const { data: existingAssignment, error: fetchError } = await supabase
      .from('assignments')
      .select(`
        *,
        courses!inner(id, instructor_id)
      `)
      .eq('id', assignmentId)
      .single();

    if (fetchError || !existingAssignment) {
      return res.status(404).json(createErrorResponse('Assignment not found'));
    }

    // Verify authorization
    const { data: teachingAssignment } = await supabase
      .from('teaching_assignments')
      .select('id')
      .eq('course_id', existingAssignment.course_id)
      .eq('teacher_id', userId)
      .single();

    if (existingAssignment.courses.instructor_id !== userId && !teachingAssignment) {
      return res.status(403).json(createErrorResponse('Not authorized to update this assignment'));
    }

    // Calculate total points for quiz
    let calculatedMaxPoints = maxPoints || existingAssignment.max_points;
    if (assignmentType === 'quiz' && questions && questions.length > 0) {
      calculatedMaxPoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);
    }

    // Prepare submission types
    let finalSubmissionTypes = submissionTypes;
    if (assignmentType === 'quiz') {
      finalSubmissionTypes = ['online_quiz'];
    } else if (typeof submissionTypes === 'string') {
      finalSubmissionTypes = [submissionTypes];
    } else if (!Array.isArray(submissionTypes)) {
      finalSubmissionTypes = existingAssignment.submission_types || ['file'];
    }

    // Update the assignment
    const { data: updatedAssignment, error: updateError } = await supabase
      .from('assignments')
      .update({
        title: title?.trim() || existingAssignment.title,
        description: description !== undefined ? description : existingAssignment.description,
        instructions: instructions || quizInstructions || existingAssignment.instructions,
        due_date: dueDate !== undefined ? dueDate : existingAssignment.due_date,
        max_points: calculatedMaxPoints,
        is_published: published !== undefined ? published : (is_published !== undefined ? is_published : existingAssignment.is_published),
        submission_type: assignmentType === 'quiz' ? 'online_quiz' : (submissionType || existingAssignment.submission_type),
        submission_types: finalSubmissionTypes,
        assignment_type: assignmentType || existingAssignment.assignment_type,
        assignment_group: assignmentGroup || existingAssignment.assignment_group,
        grading_type: gradingType || existingAssignment.grading_type,
        available_from: availableFrom !== undefined ? availableFrom : existingAssignment.available_from,
        available_until: availableUntil !== undefined ? availableUntil : existingAssignment.available_until,
        allowed_attempts: allowedAttempts !== undefined ? allowedAttempts : existingAssignment.allowed_attempts,
        has_time_limit: hasTimeLimit !== undefined ? hasTimeLimit : existingAssignment.has_time_limit,
        time_limit_minutes: hasTimeLimit ? (timeLimitMinutes || null) : null,
        shuffle_answers: shuffleAnswers !== undefined ? shuffleAnswers : existingAssignment.shuffle_answers,
        show_correct_answers: showCorrectAnswers !== undefined ? showCorrectAnswers : existingAssignment.show_correct_answers,
        one_question_at_time: oneQuestionAtTime !== undefined ? oneQuestionAtTime : existingAssignment.one_question_at_time,
        cant_go_back: cantGoBack !== undefined ? cantGoBack : existingAssignment.cant_go_back,
        require_access_code: requireAccessCode || !!accessCode || !!password,
        access_code: accessCode || password || existingAssignment.access_code,
        password: password || accessCode || existingAssignment.password,
        ip_filtering: ipFiltering !== undefined ? ipFiltering : existingAssignment.ip_filtering,
        ip_filter: ipFilter !== undefined ? ipFilter : existingAssignment.ip_filter,
        quiz_instructions: quizInstructions || instructions || existingAssignment.quiz_instructions,
        updated_at: new Date().toISOString()
      })
      .eq('id', assignmentId)
      .select()
      .single();

    if (updateError) {
      console.error('Assignment update error:', updateError);
      return res.status(400).json(createErrorResponse('Failed to update assignment'));
    }

    // If it's a quiz with questions, update the questions
    if (assignmentType === 'quiz' && questions && questions.length > 0) {
      // Delete existing questions and their answers
      const { data: existingQuestions } = await supabase
        .from('quiz_questions')
        .select('id')
        .eq('assignment_id', assignmentId);

      if (existingQuestions && existingQuestions.length > 0) {
        const questionIds = existingQuestions.map(q => q.id);
        
        // Delete answers first (due to foreign key constraints)
        await supabase
          .from('quiz_question_answers')
          .delete()
          .in('question_id', questionIds);

        // Delete short answer options
        await supabase
          .from('quiz_short_answer_options')
          .delete()
          .in('question_id', questionIds);

        // Delete questions
        await supabase
          .from('quiz_questions')
          .delete()
          .eq('assignment_id', assignmentId);
      }

      // Create new questions
      for (let questionIndex = 0; questionIndex < questions.length; questionIndex++) {
        const question = questions[questionIndex];
        
        if (!question.questionText || !question.questionType) {
          console.error(`Invalid question at index ${questionIndex}:`, question);
          continue;
        }

        const { data: createdQuestion, error: questionError } = await supabase
          .from('quiz_questions')
          .insert({
            assignment_id: assignmentId,
            question_number: questionIndex + 1,
            title: question.title || `Question ${questionIndex + 1}`,
            question_text: question.questionText,
            question_type: question.questionType,
            points: question.points || 1,
            image_url: question.imageUrl || null,
            short_answer_match_type: question.questionType === 'short_answer' ? (question.matchType || 'exact') : null,
            short_answer_case_sensitive: question.questionType === 'short_answer' ? (question.caseSensitive || false) : null
          })
          .select()
          .single();

        if (questionError) {
          console.error('Error creating question:', questionError);
          continue;
        }

        // Handle different question types
        if (question.questionType === 'multiple_choice' || question.questionType === 'true_false') {
          if (question.answers && question.answers.length > 0) {
            const answersToInsert = question.answers.map((answer, index) => ({
              question_id: createdQuestion.id,
              answer_text: answer.text || '',
              is_correct: answer.correct || false,
              feedback: answer.feedback || '',
              answer_order: index + 1
            }));

            await supabase
              .from('quiz_question_answers')
              .insert(answersToInsert);
          }
        } else if (question.questionType === 'short_answer') {
          if (question.acceptableAnswers && question.acceptableAnswers.length > 0) {
            const acceptableAnswersToInsert = question.acceptableAnswers
              .filter(answer => answer && answer.trim())
              .map((answer, index) => ({
                question_id: createdQuestion.id,
                answer_text: answer.trim(),
                is_case_sensitive: question.caseSensitive || false,
                is_exact_match: question.matchType !== 'contains',
                answer_order: index + 1
              }));

            if (acceptableAnswersToInsert.length > 0) {
              await supabase
                .from('quiz_short_answer_options')
                .insert(acceptableAnswersToInsert);
            }
          }
        }
      }
    }

    // Fetch complete updated assignment
    let completeAssignment = updatedAssignment;
    if (assignmentType === 'quiz') {
      const { data: questionsData } = await supabase
        .from('quiz_questions')
        .select(`
          *,
          quiz_question_answers(*),
          quiz_short_answer_options(*)
        `)
        .eq('assignment_id', assignmentId)
        .order('question_number');

      completeAssignment = {
        ...updatedAssignment,
        questions: questionsData || []
      };
    }

    res.status(200).json(createSuccessResponse({
      assignment: completeAssignment,
      message: `${assignmentType === 'quiz' ? 'Quiz' : 'Assignment'} updated successfully`
    }));

  } catch (error) {
    console.error('Update assignment error:', error);
    res.status(500).json(createErrorResponse('Failed to update assignment'));
  }
};



// Get all assignments for a course
export const getAssignmentsByCourse = async (req, res) => {
  console.log("endpoint running")
  try {
    const { courseId } = req.params;
    const currentUser = req.user;

    console.log('Fetching assignments for course:', courseId);

    // Check if user has access to this course
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('id, instructor_id, title')
      .eq('id', courseId)
      .single();

    if (courseError || !course) {
      return res.status(404).json(createErrorResponse('Course not found'));
    }

    // Check access permissions
    let hasAccess = false;

    // Admin has access to all courses
    if (currentUser.role === 'admin') {
      hasAccess = true;
    }
    // Teacher has access if they're the instructor
    else if (currentUser.role === 'teacher' && course.instructor_id === currentUser.id) {
      hasAccess = true;
    }
    // Student has access if they're enrolled
    else if (currentUser.role === 'student') {
      const { data: enrollment } = await supabase
        .from('course_enrollments')
        .select('id')
        .eq('course_id', courseId)
        .eq('student_id', currentUser.id)
        .eq('status', 'active')
        .single();

      hasAccess = !!enrollment;
    }

    if (!hasAccess) {
      return res.status(403).json(createErrorResponse('Access denied to this course'));
    }

    // Fetch assignments
    let query = supabase
      .from('assignments')
      .select(`
        id,
        title,
        description,
        instructions,
        due_date,
        max_points,
        is_published,
        submission_type,
        assignment_type,
        assignment_group,
        grading_type,
        available_from,
        available_until,
        allowed_attempts,
        has_time_limit,
        time_limit_minutes,
        created_at,
        updated_at
      `)
      .eq('course_id', courseId)
      .order('created_at', { ascending: false });

    // If student, only show published assignments
    if (currentUser.role === 'student') {
      query = query.eq('is_published', true);
    }

    const { data: assignments, error: assignmentsError } = await query;

    if (assignmentsError) {
      console.error('Error fetching assignments:', assignmentsError);
      return res.status(500).json(createErrorResponse('Failed to fetch assignments'));
    }

    // For students, also get their submission status for each assignment
    let assignmentsWithStatus = assignments || [];

    if (currentUser.role === 'student' && assignments && assignments.length > 0) {
      const assignmentIds = assignments.map(a => a.id);
      
      const { data: submissions } = await supabase
        .from('assignment_submissions')
        .select('assignment_id, status, submitted_at, score')
        .eq('student_id', currentUser.id)
        .in('assignment_id', assignmentIds);

      // Add submission status to each assignment
      assignmentsWithStatus = assignments.map(assignment => {
        const submission = submissions?.find(s => s.assignment_id === assignment.id);
        return {
          ...assignment,
          submission_status: submission?.status || null,
          submitted_at: submission?.submitted_at || null,
          score: submission?.score || null
        };
      });
    }

    // For teachers, get submission counts
    if (currentUser.role === 'teacher' && assignments && assignments.length > 0) {
      const assignmentIds = assignments.map(a => a.id);
      
      const { data: submissionCounts } = await supabase
        .from('assignment_submissions')
        .select('assignment_id')
        .in('assignment_id', assignmentIds);

      // Count submissions per assignment
      const submissionCountMap = {};
      submissionCounts?.forEach(sub => {
        submissionCountMap[sub.assignment_id] = (submissionCountMap[sub.assignment_id] || 0) + 1;
      });

      // Add submission counts to assignments
      assignmentsWithStatus = assignments.map(assignment => ({
        ...assignment,
        submission_count: submissionCountMap[assignment.id] || 0
      }));
    }

    console.log(`Found ${assignmentsWithStatus.length} assignments for course ${courseId}`);

    res.json(createSuccessResponse({
      assignments: assignmentsWithStatus,
      count: assignmentsWithStatus.length,
      course: {
        id: course.id,
        title: course.title
      }
    }));

  } catch (error) {
    console.error('Get assignments by course error:', error);
    res.status(500).json(createErrorResponse(error.message));
  }
};

// Additional route: Get single assignment with details
export const getAssignmentById = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Get assignment with course info
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select(`
        *,
        courses!inner (
          id,
          instructor_id
        )
      `)
      .eq('id', assignmentId)
      .single();

    if (assignmentError || !assignment) {
      return res.status(404).json(createErrorResponse('Assignment not found'));
    }

    // Check authorization
    const isInstructor = assignment.courses.instructor_id === userId;
    const isAdmin = userRole === 'admin';
    
    let isEnrolled = false;
    if (!isInstructor && !isAdmin) {
      // Check if assignment is published
      if (!assignment.is_published) {
        return res.status(403).json(createErrorResponse('Assignment not available'));
      }

      const { data: enrollmentData } = await supabase
        .from('course_enrollments')
        .select('id')
        .eq('course_id', assignment.course_id)
        .eq('student_id', userId)
        .eq('status', 'active')
        .single();
      
      isEnrolled = !!enrollmentData;
    }

    if (!isInstructor && !isAdmin && !isEnrolled) {
      return res.status(403).json(createErrorResponse('Not authorized to view this assignment'));
    }

    // For quizzes, get questions if it's the instructor or if quiz is available
    let questions = null;
    if (assignment.assignment_type === 'quiz') {
      // Check if quiz is currently available for students
      const now = new Date();
      const availableFrom = assignment.available_from ? new Date(assignment.available_from) : null;
      const availableUntil = assignment.available_until ? new Date(assignment.available_until) : null;
      
      const isAvailable = (!availableFrom || now >= availableFrom) && 
                         (!availableUntil || now <= availableUntil);

      if (isInstructor || isAdmin || isAvailable) {
        const { data: quizQuestions } = await supabase
          .from('quiz_questions')
          .select(`
            *,
            quiz_question_answers (*)
          `)
          .eq('assignment_id', assignmentId)
          .order('question_number', { ascending: true });

        questions = quizQuestions;
      }
    }

    // Get student's submission if applicable
    let submission = null;
    if (isEnrolled && !isInstructor && !isAdmin) {
      const { data: submissionData } = await supabase
        .from('assignment_submissions')
        .select('*')
        .eq('assignment_id', assignmentId)
        .eq('student_id', userId)
        .order('attempt_number', { ascending: false })
        .limit(1)
        .single();

      submission = submissionData;
    }

    res.json(createSuccessResponse({
      assignment: {
        ...sanitizeAssignment(assignment),
        questions: questions,
        submission: submission
      }
    }));

  } catch (error) {
    console.error('Get assignment error:', error);
    res.status(500).json(createErrorResponse('Failed to fetch assignment'));
  }
};


export const getUserSubmissions = async (req, res) => {
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
        GROUP BY q.id
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
      submission: assignment.submission_id
        ? {
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
            percentage:
              assignment.score && assignment.max_points
                ? Math.round((assignment.score / assignment.max_points) * 1000) / 10
                : null
          }
        : null,
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
};



export const getUserSubmissions1 = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = req.user.id;

    // Get assignment and verify access
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select(`
        *,
        courses!inner(id, instructor_id)
      `)
      .eq('id', assignmentId)
      .single();

    if (assignmentError || !assignment) {
      return res.status(404).json(createErrorResponse('Assignment not found'));
    }

    // Check if student is enrolled or is instructor/admin
    const isInstructor = assignment.courses.instructor_id === userId;
    const isAdmin = req.user.role === 'admin';
    
    let isEnrolled = false;
    if (!isInstructor && !isAdmin) {
      const { data: enrollmentData } = await supabase
        .from('course_enrollments')
        .select('id')
        .eq('course_id', assignment.course_id)
        .eq('student_id', userId)
        .eq('status', 'active')
        .single();
      
      isEnrolled = !!enrollmentData;
    }

    if (!isInstructor && !isAdmin && !isEnrolled) {
      return res.status(403).json(createErrorResponse('Not authorized to view submissions for this assignment'));
    }

    // Get submissions
    let query = supabase
      .from('assignment_submissions')
      .select('*')
      .eq('assignment_id', assignmentId)
      .order('submitted_at', { ascending: false });

    // If student, only show their own submissions
    if (!isInstructor && !isAdmin) {
      query = query.eq('student_id', userId);
    }

    const { data: submissions, error } = await query;

    if (error) {
      console.error('Get submissions error:', error);
      return res.status(500).json(createErrorResponse('Failed to fetch submissions'));
    }

    res.json(createSuccessResponse({
      submissions: submissions || [],
      count: submissions?.length || 0
    }));

  } catch (error) {
    console.error('Get user submissions error:', error);
    res.status(500).json(createErrorResponse('Failed to fetch submissions'));
  }
};

// Verify quiz password
export const verifyQuizPassword = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { password } = req.body;
    const userId = req.user.id;

    if (!password) {
      return res.status(400).json(createErrorResponse('Password is required'));
    }

    // Get assignment
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select(`
        *,
        courses!inner(id, instructor_id)
      `)
      .eq('id', assignmentId)
      .single();

    if (assignmentError || !assignment) {
      return res.status(404).json(createErrorResponse('Assignment not found'));
    }

    // Check if student is enrolled
    const { data: enrollmentData } = await supabase
      .from('course_enrollments')
      .select('id')
      .eq('course_id', assignment.course_id)
      .eq('student_id', userId)
      .eq('status', 'active')
      .single();

    if (!enrollmentData) {
      return res.status(403).json(createErrorResponse('Not enrolled in this course'));
    }

    // Check if assignment is published
    if (!assignment.is_published) {
      return res.status(403).json(createErrorResponse('Assignment not yet available'));
    }

    // Verify password
    const isPasswordCorrect = assignment.password === password;

    if (isPasswordCorrect) {
      res.json(createSuccessResponse({ verified: true }, 'Password verified successfully'));
    } else {
      res.status(401).json(createErrorResponse('Incorrect password'));
    }

  } catch (error) {
    console.error('Verify password error:', error);
    res.status(500).json(createErrorResponse('Failed to verify password'));
  }
};


//submit quiz answers

// Enhanced quiz submission grading function
export const submitQuizAnswers = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { answers } = req.body;
    const userId = req.user.id;

    // Get assignment details
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select('*')
      .eq('id', assignmentId)
      .single();

    if (assignmentError || !assignment) {
      return res.status(404).json(createErrorResponse('Assignment not found'));
    }

    // Get all questions with their answers and short answer options
    const { data: questions, error: questionsError } = await supabase
      .from('quiz_questions')
      .select(`
        *,
        quiz_question_answers(*),
        quiz_short_answer_options(*)
      `)
      .eq('assignment_id', assignmentId)
      .order('question_number');

    if (questionsError) {
      return res.status(400).json(createErrorResponse('Failed to load questions'));
    }

    let autoGradedScore = 0;
    let totalPossiblePoints = 0;
    const detailedResults = {};

    // Grade each question
    for (const question of questions) {
      totalPossiblePoints += question.points;
      const userAnswer = answers[question.id];
      
      if (!userAnswer) {
        detailedResults[question.id] = {
          correct: false,
          points: 0,
          requiresManualGrading: false
        };
        continue;
      }

      // Handle different question types
      if (question.question_type === 'multiple_choice' || question.question_type === 'true_false') {
        // Multiple choice grading
        const selectedAnswer = question.quiz_question_answers.find(
          answer => answer.id === userAnswer.answerId
        );
        
        const isCorrect = selectedAnswer?.is_correct || false;
        detailedResults[question.id] = {
          correct: isCorrect,
          points: isCorrect ? question.points : 0,
          requiresManualGrading: false
        };
        
        if (isCorrect) {
          autoGradedScore += question.points;
        }
      } else if (question.question_type === 'short_answer') {
        // Short answer grading - THIS IS THE FIX
        const userText = userAnswer.textAnswer?.trim() || '';
        const shortAnswerOptions = question.quiz_short_answer_options || [];
        
        let isCorrect = false;
        
        // Check each acceptable answer
        for (const option of shortAnswerOptions) {
          const optionText = option.answer_text?.trim() || '';
          
          if (option.is_exact_match) {
            // Exact match comparison
            if (option.is_case_sensitive) {
              isCorrect = userText === optionText;
            } else {
              isCorrect = userText.toLowerCase() === optionText.toLowerCase();
            }
          } else {
            // Contains match comparison
            if (option.is_case_sensitive) {
              isCorrect = userText.includes(optionText);
            } else {
              isCorrect = userText.toLowerCase().includes(optionText.toLowerCase());
            }
          }
          
          if (isCorrect) break; // Found a match, no need to check other options
        }
        
        // FALLBACK: If no quiz_short_answer_options exist, check against the question text
        // This handles the case where the question is "Answer michael" and we expect "michael"
        if (!isCorrect && shortAnswerOptions.length === 0) {
          // Extract expected answer from question text
          const questionText = question.question_text.toLowerCase();
          const userTextLower = userText.toLowerCase();
          
          // Simple pattern matching for questions like "Answer michael", "Type hello", etc.
          const patterns = [
            /answer\s+(.+)/i,
            /type\s+(.+)/i,
            /enter\s+(.+)/i,
            /write\s+(.+)/i
          ];
          
          for (const pattern of patterns) {
            const match = question.question_text.match(pattern);
            if (match && match[1]) {
              const expectedAnswer = match[1].trim().toLowerCase();
              // Use case-insensitive and flexible matching
              if (question.short_answer_case_sensitive === false || question.short_answer_case_sensitive == null) {
                isCorrect = userTextLower === expectedAnswer;
              } else {
                isCorrect = userText.trim() === match[1].trim();
              }
              break;
            }
          }
        }
        
        detailedResults[question.id] = {
          correct: isCorrect,
          points: isCorrect ? question.points : 0,
          requiresManualGrading: false
        };
        
        if (isCorrect) {
          autoGradedScore += question.points;
        }
      } else {
        // Essay, file upload, or other question types require manual grading
        detailedResults[question.id] = {
          requiresManualGrading: true,
          points: 0
        };
      }
    }

    // Create submission record
    const { data: submission, error: submissionError } = await supabase
      .from('assignment_submissions')
      .insert({
        assignment_id: assignmentId,
        student_id: userId,
        quiz_data: JSON.stringify({
          answers,
          detailedResults,
          autoGradedScore,
          totalPossiblePoints
        }),
        score: autoGradedScore,
        status: Object.values(detailedResults).some(result => result.requiresManualGrading) 
          ? 'submitted' 
          : 'graded',
        submitted_at: new Date().toISOString(),
        attempt_number: 1 // You might want to implement attempt tracking
      })
      .select()
      .single();

    if (submissionError) {
      return res.status(400).json(createErrorResponse('Failed to submit quiz'));
    }

    res.json(createSuccessResponse({
      submissionId: submission.id,
      score: autoGradedScore,
      totalPoints: totalPossiblePoints,
      detailedResults,
      requiresManualGrading: Object.values(detailedResults).some(result => result.requiresManualGrading)
    }));

  } catch (error) {
    console.error('Submit quiz error:', error);
    res.status(500).json(createErrorResponse('Failed to submit quiz'));
  }
};

// Alternative grading function specifically for short answers
const gradeShortAnswer = (question, userAnswer) => {
  const userText = userAnswer?.textAnswer?.trim() || '';
  
  // First check quiz_short_answer_options table
  if (question.quiz_short_answer_options && question.quiz_short_answer_options.length > 0) {
    for (const option of question.quiz_short_answer_options) {
      const optionText = option.answer_text?.trim() || '';
      let isMatch = false;
      
      if (option.is_exact_match) {
        isMatch = option.is_case_sensitive 
          ? userText === optionText
          : userText.toLowerCase() === optionText.toLowerCase();
      } else {
        isMatch = option.is_case_sensitive
          ? userText.includes(optionText)
          : userText.toLowerCase().includes(optionText.toLowerCase());
      }
      
      if (isMatch) {
        return {
          correct: true,
          points: question.points,
          requiresManualGrading: false
        };
      }
    }
    
    return {
      correct: false,
      points: 0,
      requiresManualGrading: false
    };
  }
  
  // Fallback: Parse expected answer from question text
  const questionText = question.question_text;
  const patterns = [
    { pattern: /answer\s+"?([^"]+)"?/i, group: 1 },
    { pattern: /type\s+"?([^"]+)"?/i, group: 1 },
    { pattern: /enter\s+"?([^"]+)"?/i, group: 1 },
    { pattern: /write\s+"?([^"]+)"?/i, group: 1 }
  ];
  
  for (const { pattern, group } of patterns) {
    const match = questionText.match(pattern);
    if (match && match[group]) {
      const expectedAnswer = match[group].trim();
      const caseSensitive = question.short_answer_case_sensitive || false;
      
      let isCorrect;
      if (caseSensitive) {
        isCorrect = userText === expectedAnswer;
      } else {
        isCorrect = userText.toLowerCase() === expectedAnswer.toLowerCase();
      }
      
      return {
        correct: isCorrect,
        points: isCorrect ? question.points : 0,
        requiresManualGrading: false
      };
    }
  }
  
  // If no pattern matches, require manual grading
  return {
    requiresManualGrading: true,
    points: 0
  };
};

// Helper function to normalize text for comparison
const normalizeText = (text, options = {}) => {
  let normalized = text.trim();
  
  if (options.removeSpaces) {
    normalized = normalized.replace(/\s+/g, '');
  }
  
  if (options.removePunctuation) {
    normalized = normalized.replace(/[^\w\s]/gi, '');
  }
  
  if (!options.caseSensitive) {
    normalized = normalized.toLowerCase();
  }
  
  return normalized;
};


// Get quiz results for student
export const getQuizResults = async (req, res) => {
  try {
    const { submissionId } = req.params;
    const userId = req.user.id;

    // Get submission with assignment details
    const { data: submission, error: submissionError } = await supabase
      .from('assignment_submissions')
      .select(`
        *,
        assignments!inner(
          id,
          title,
          show_correct_answers,
          course_id,
          courses!inner(instructor_id)
        )
      `)
      .eq('id', submissionId)
      .single();

    if (submissionError || !submission) {
      return res.status(404).json(createErrorResponse('Submission not found'));
    }

    // Check if user owns this submission or is instructor/admin
    const isOwner = submission.student_id === userId;
    const isInstructor = submission.assignments.courses.instructor_id === userId;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isInstructor && !isAdmin) {
      return res.status(403).json(createErrorResponse('Not authorized to view this submission'));
    }

    // Get questions and answers if allowed to show correct answers
    let questionsWithAnswers = null;
    
    if (submission.assignments.show_correct_answers && isOwner) {
      const { data: questions } = await supabase
        .from('quiz_questions')
        .select(`
          id,
          title,
          question_text,
          points,
          quiz_question_answers(*)
        `)
        .eq('assignment_id', submission.assignment_id)
        .order('question_number');

      questionsWithAnswers = questions;
    }

    res.json(createSuccessResponse({
      submission: {
        id: submission.id,
        assignmentId: submission.assignment_id,
        assignmentTitle: submission.assignments.title,
        score: submission.score,
        attemptNumber: submission.attempt_number,
        submittedAt: submission.submitted_at,
        quizData: submission.quiz_data,
        status: submission.status,
        feedback: submission.feedback
      },
      questions: questionsWithAnswers,
      canViewAnswers: submission.assignments.show_correct_answers && isOwner
    }));

  } catch (error) {
    console.error('Get quiz results error:', error);
    res.status(500).json(createErrorResponse('Failed to fetch quiz results'));
  }
};


export const getAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = req.user.id;

    // Get assignment
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select(`
        *,
        courses!inner(id, instructor_id)
      `)
      .eq('id', assignmentId)
      .single();

    if (assignmentError || !assignment) {
      return res.status(404).json(createErrorResponse('Assignment not found'));
    }

    // Check access permissions
    const isInstructor = assignment.courses.instructor_id === userId;
    const isAdmin = req.user.role === 'admin';
    
    // Always check for enrollment, regardless of other roles
    let isEnrolled = false;
    if (!isInstructor && !isAdmin) {
      const { data: enrollmentData, error: enrollmentError } = await supabase
        .from('course_enrollments')
        .select('id, status')
        .eq('course_id', assignment.course_id)
        .eq('student_id', userId)
        .eq('status', 'active')
        .single();
      
      if (!enrollmentError && enrollmentData) {
        isEnrolled = true;
      }

      // Debug logging to help identify the issue
      console.log('Enrollment check:', {
        userId,
        courseId: assignment.course_id,
        enrollmentData,
        enrollmentError: enrollmentError?.message,
        isEnrolled
      });
    }

    // Check access permissions
    if (!isInstructor && !isAdmin && !isEnrolled) {
      return res.status(403).json(createErrorResponse('Not authorized to view this assignment'));
    }

    // If student and assignment is not published, deny access
    if (!isInstructor && !isAdmin && !assignment.is_published) {
      return res.status(403).json(createErrorResponse('Assignment is not yet available'));
    }

    // Get questions if it's a quiz
    let questions = [];
    if (assignment.assignment_type === 'quiz') {
      const { data: questionsData, error: questionsError } = await supabase
        .from('quiz_questions')
        .select(`
          *,
          quiz_question_answers(*)
        `)
        .eq('assignment_id', assignmentId)
        .order('question_number');

      if (!questionsError && questionsData) {
        questions = questionsData.map(q => ({
          ...sanitizeQuestion(q),
          answers: q.quiz_question_answers.map(sanitizeAnswer)
        }));
      }
    }

    // Initialize submission tracking variables
    let studentSubmission = null;
    let hasSubmitted = false;
    let canRetake = false;
    let attemptsUsed = 0;

    // FIXED: Check for submissions for students only (not instructors/admins)
    // This should run for any user who is a student, regardless of enrollment status
    const isStudent = !isInstructor && !isAdmin;
    
    if (isStudent) {
      console.log('Checking submissions for student:', userId, 'assignment:', assignmentId);
      
      // Get all submissions for this student and assignment
      const { data: submissions, error: submissionError } = await supabase
        .from('assignment_submissions')
        .select(`
          id,
          assignment_id,
          student_id,
          content,
          file_url,
          score,
          feedback,
          status,
          submitted_at,
          graded_at,
          graded_by,
          quiz_data,
          attempt_number,
          time_started,
          time_completed,
          auto_submitted
        `)
        .eq('assignment_id', assignmentId)
        .eq('student_id', userId)
        .order('submitted_at', { ascending: false });

      console.log('Submission query result:', {
        submissions: submissions?.length || 0,
        submissionError: submissionError?.message
      });

      if (!submissionError && submissions && submissions.length > 0) {
        hasSubmitted = true;
        attemptsUsed = submissions.length;
        
        // Get the latest submission
        studentSubmission = submissions[0];
        
        // Check if student can retake
        if (assignment.allowed_attempts === -1 || attemptsUsed < assignment.allowed_attempts) {
          canRetake = true;
        }

        console.log('Submission details:', {
          hasSubmitted,
          attemptsUsed,
          allowedAttempts: assignment.allowed_attempts,
          canRetake
        });

        // For quiz assignments, get detailed submission data from quiz_data field
        if (assignment.assignment_type === 'quiz' && assignment.show_correct_answers && studentSubmission.quiz_data) {
          try {
            // Parse quiz_data JSON which contains answers and detailed results
            const quizData = typeof studentSubmission.quiz_data === 'string' 
              ? JSON.parse(studentSubmission.quiz_data) 
              : studentSubmission.quiz_data;
            
            studentSubmission.quizDetails = quizData;
          } catch (error) {
            console.error('Error parsing quiz_data:', error);
          }
        }
      } else {
        // No submissions found
        canRetake = true; // First attempt
        console.log('No submissions found, allowing first attempt');
      }
    }

    // Build response
    const responseData = {
      assignment: sanitizeAssignment(assignment),
      questions,
      canEdit: isInstructor || isAdmin,
      isStudent: isStudent,
      hasSubmitted,
      canRetake,
      attemptsUsed,
      attemptsRemaining: assignment.allowed_attempts === -1 ? 'unlimited' : Math.max(0, assignment.allowed_attempts - attemptsUsed)
    };

    // Add submission data if exists
    if (studentSubmission) {
      // Calculate percentage if not stored directly
      const percentage = studentSubmission.score && assignment.max_points 
        ? (studentSubmission.score / assignment.max_points) * 100 
        : null;

      responseData.submission = {
        id: studentSubmission.id,
        score: studentSubmission.score,
        maxScore: assignment.max_points, // Get from assignment since not stored in submission
        percentage: percentage,
        status: studentSubmission.status,
        feedback: studentSubmission.feedback,
        submittedAt: studentSubmission.submitted_at,
        gradedAt: studentSubmission.graded_at,
        attemptNumber: studentSubmission.attempt_number,
        quizDetails: studentSubmission.quizDetails || null
      };
    }

    // Debug logging for the final response
    console.log('Final response data:', {
      isStudent,
      isInstructor,
      isAdmin,
      isEnrolled,
      hasSubmitted,
      canRetake,
      attemptsUsed,
      attemptsRemaining: responseData.attemptsRemaining
    });

    res.json(createSuccessResponse(responseData));

  } catch (error) {
    console.error('Get assignment error:', error);
    res.status(500).json(createErrorResponse('Failed to fetch assignment'));
  }
};// Get single assignment with questions


// Delete assignment
export const deleteAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = req.user.id;

    // Get assignment and verify ownership
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select(`
        *,
        courses!inner(id, instructor_id)
      `)
      .eq('id', assignmentId)
      .single();

    if (assignmentError || !assignment) {
      return res.status(404).json(createErrorResponse('Assignment not found'));
    }

    // Check permissions
    if (assignment.courses.instructor_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json(createErrorResponse('Not authorized to delete this assignment'));
    }

    // Delete assignment (cascade will handle questions and answers)
    const { error: deleteError } = await supabase
      .from('assignments')
      .delete()
      .eq('id', assignmentId);

    if (deleteError) {
      console.error('Assignment deletion error:', deleteError);
      return res.status(400).json(createErrorResponse('Failed to delete assignment'));
    }

    res.json(createSuccessResponse({}, 'Assignment deleted successfully'));

  } catch (error) {
    console.error('Delete assignment error:', error);
    res.status(500).json(createErrorResponse('Failed to delete assignment'));
  }
};

// Publish/unpublish assignment
export const toggleAssignmentPublish = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { published } = req.body;
    const userId = req.user.id;

    // Get assignment and verify ownership
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select(`
        *,
        courses!inner(id, instructor_id)
      `)
      .eq('id', assignmentId)
      .single();

    if (assignmentError || !assignment) {
      return res.status(404).json(createErrorResponse('Assignment not found'));
    }

    // Check permissions
    if (assignment.courses.instructor_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json(createErrorResponse('Not authorized to publish/unpublish this assignment'));
    }

    // Update publish status
    const { data: updatedAssignment, error: updateError } = await supabase
      .from('assignments')
      .update({
        is_published: published,
        updated_at: new Date().toISOString()
      })
      .eq('id', assignmentId)
      .select()
      .single();

    if (updateError) {
      console.error('Assignment publish error:', updateError);
      return res.status(400).json(createErrorResponse('Failed to update assignment status'));
    }

    res.json(createSuccessResponse({
      assignment: sanitizeAssignment(updatedAssignment)
    }, `Assignment ${published ? 'published' : 'unpublished'} successfully`));

  } catch (error) {
    console.error('Toggle assignment publish error:', error);
    res.status(500).json(createErrorResponse('Failed to update assignment status'));
  }
};

export default {
  createAssignment,
  getAssignment,
  getAssignmentsByCourse,
  updateAssignment,
  deleteAssignment,
  toggleAssignmentPublish,
  getUserSubmissions,
  verifyQuizPassword,
  submitQuizAnswers,
  getQuizResults
};