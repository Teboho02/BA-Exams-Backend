// server.js (Step 3: Add all routes)
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';

dotenv.config();

console.log('🚀 Starting server with all routes...');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
console.log('🔒 Adding security middleware...');
app.use(helmet());
const allowedOrigins = ['https://edu-livid.vercel.app'];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));


console.log('📝 Adding parsing middleware...');
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Rate limiting
console.log('⏱️  Adding rate limiting...');
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.'
  }
});

app.use('/api/', generalLimiter);
app.use('/api/auth', authLimiter);

// Load routes with individual error handling
const routes = [
  { path: '/api/auth', file: './routes/auth.routes.js', name: 'Auth' },
  { path: '/api/courses', file: './routes/course.routes.js', name: 'Course' },
  { path: '/api/assignments', file: './routes/assignment.routes.js', name: 'Assignment' },
  { path: '/api/quiz', file: './routes/quiz.routes.js', name: 'Quiz' },
  { path: '/api/teacher-review', file: './routes/teacherReview.routes.js', name: 'Teacher Review' } 
];

for (const route of routes) {
  try {
    console.log(`📡 Loading ${route.name} routes...`);
    const routeModule = await import(route.file);
    app.use(route.path, routeModule.default);
    console.log(`✅ ${route.name} routes loaded successfully`);
  } catch (error) {
    console.error(`❌ Failed to load ${route.name} routes:`, error.message);
    console.log(`⏭️  Continuing without ${route.name} routes...`);
  }
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'API is healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    routes: {
      auth: '/api/auth/*',
      courses: '/api/courses/*',
      assignments: '/api/assignments/*',
      health: '/api/health'
    }
  });
});
// Add this after mounting your routes to see what's registered
console.log('Registered routes:');
app._router.stack.forEach(function(r){
  if (r.route && r.route.path){
    console.log(`${Object.keys(r.route.methods).join(', ').toUpperCase()} ${r.route.path}`);
  }
});
// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Global error handler:', err.stack);
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: err.errors
    });
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized access'
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start server
const server = app.listen(PORT, (err) => {
  if (err) {
    console.error('❌ Server start error:', err);
    process.exit(1);
  }
  console.log(`✅ Server running successfully on port ${PORT}`);
  console.log(`🔗 API URL: http://localhost:${PORT}/api`);
  console.log(`📋 Available endpoints:`);
  console.log(`   🔐 Auth: /api/auth/*`);
  console.log(`   📚 Courses: /api/courses/*`);
  console.log(`   📝 Assignments: /api/assignments/*`);
  console.log(`   ❤️  Health: /api/health`);
});

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
  
  server.close((err) => {
    if (err) {
      console.error('❌ Error during server shutdown:', err);
      process.exit(1);
    }
    console.log('✅ Server closed successfully');
    process.exit(0);
  });
  
  setTimeout(() => {
    console.log('⚠️  Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled rejection:', err);
  process.exit(1);
});