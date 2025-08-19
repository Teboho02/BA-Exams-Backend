// server.js (Step 3: Add all routes + serve frontend)
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

console.log('🚀 Starting server with all routes...');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

const allowedOrigins = [
  'http://localhost:5173', // Vite dev server
  'https://edu-livid.vercel.app', // Production frontend
  `http://localhost:${PORT}`, // Same server
  'https://edu-platform-backend-uuzw.onrender.com', // Render production backend
  `http://localhost:3000` // Default fallback
];

// For serving frontend from same server, we can be more permissive with CORS
app.use(cors({
  origin: function (origin, callback) {
    // Allow same-origin requests (when frontend is served from same server)
    // Allow requests with no origin (like mobile apps, Postman, etc.)
    // Allow specific external origins
    const allowedOrigins = [
      'http://localhost:5173', // Vite dev server
      'https://edu-livid.vercel.app', // Production frontend
      'https://edu-platform-backend-uuzw.onrender.com', // Render production backend
      `http://localhost:${PORT}`, // Same server
      `http://localhost:3000` // Default fallback
    ];
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`❌ CORS blocked request from origin: ${origin}`);
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

// app.use('/api/', generalLimiter);
// app.use('/api/auth', authLimiter);

// Add debugging middleware for requests
app.use((req, res, next) => {
  console.log(`📥 Request: ${req.method} ${req.path}`);
  next();
});

// Load routes with individual error handling
const routes = [
  { path: '/api/auth', file: './routes/auth.routes.js', name: 'Auth' },
  { path: '/api/courses', file: './routes/course.routes.js', name: 'Course' },
  { path: '/api/assignments', file: './routes/assignment.routes.js', name: 'Assignment' },
  { path: '/api/quiz', file: './routes/quiz.routes.js', name: 'Quiz' },
  { path: '/api/teacher-review', file: './routes/teacherReview.routes.js', name: 'Teacher Review' } ,
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
    message: 'API is up and running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// Serve static files from the dist directory
console.log('🌐 Setting up frontend serving...');
const distPath = path.join(__dirname, 'dist');
console.log(`📁 Serving static files from: ${distPath}`);

// Check if dist directory exists
if (!fs.existsSync(distPath)) {
  console.error(`❌ Dist directory not found at: ${distPath}`);
  console.log('💡 Make sure to build your frontend first with: npm run build');
} else {
  console.log(`✅ Dist directory found`);
  try {
    const files = fs.readdirSync(distPath);
    console.log(`📋 Files in dist:`, files);
  } catch (err) {
    console.error('Error reading dist directory:', err);
  }
}

// Serve static files with proper headers
app.use(express.static(distPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
    console.log(`📤 Serving static file: ${path.basename(filePath)}`);
  }
}));

// Handle client-side routing (SPA fallback)
app.get('*', (req, res) => {
  console.log(`🔍 Catch-all handler for: ${req.path}`);
  
  // Don't serve index.html for API routes
  if (req.path.startsWith('/api')) {
    console.log(`❌ API route not found: ${req.path}`);
    return res.status(404).json({
      success: false,
      message: 'API endpoint not found'
    });
  }
  
  // Don't serve index.html for static asset requests
  const isStaticAsset = req.path.startsWith('/assets/') || 
                       req.path.match(/\.(js|css|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|map)$/);
  
  if (isStaticAsset) {
    console.log(`❌ Static asset not found: ${req.path}`);
    return res.status(404).json({
      success: false,
      message: 'Static asset not found',
      path: req.path
    });
  }
  
  // Serve index.html for all other routes (SPA routing)
  console.log(`🏠 Serving index.html for SPA route: ${req.path}`);
  const indexPath = path.join(distPath, 'index.html');
  
  if (!fs.existsSync(indexPath)) {
    console.error(`❌ index.html not found at: ${indexPath}`);
    return res.status(500).json({
      success: false,
      message: 'Application not built. Please run npm run build first.',
      path: indexPath
    });
  }
  
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error('❌ Error serving index.html:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to serve application'
      });
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
  console.log(`🌐 Frontend URL: http://localhost:${PORT}`);
  console.log(`📋 Available endpoints:`);
  console.log(`   🔐 Auth: /api/auth/*`);
  console.log(`   📚 Courses: /api/courses/*`);
  console.log(`   📝 Assignments: /api/assignments/*`);
  console.log(`   ❓ Quiz: /api/quiz/*`);
  console.log(`   👨‍🏫 Teacher Review: /api/teacher-review/*`);
  console.log(`   ❤️  Health: /api/health`);
  console.log(`   🏠 Frontend: /* (SPA routing)`);
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