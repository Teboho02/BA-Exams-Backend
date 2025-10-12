
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

console.log('🚀 Starting server with all routes...');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

// Updated Helmet configuration to allow inline styles (needed for Vite builds)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: [
        "'self'",
        "http://localhost:3000",
        "https://www.baonlineexaminations.com",
        "https://baonlineexaminations.com",
        "https://edu-platform-backend-uuzw.onrender.com"
      ], // Allow API connections
      styleSrc: ["'self'", "'unsafe-inline'", "data:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "data:"],
    },
  },
}));

const allowedOrigins = [
  'http://localhost:5173',
  'https://edu-livid.vercel.app',
  `http://localhost:${PORT}`,
  'https://edu-platform-backend-uuzw.onrender.com',
  `http://localhost:3000`,
  'https://www.baonlineexaminations.com',  
  'https://baonlineexaminations.com'       //
];

app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:5173',
      'https://edu-livid.vercel.app',
      `http://localhost:${PORT}`,
      'https://edu-platform-backend-uuzw.onrender.com',
      `http://localhost:3000`,
      'https://www.baonlineexaminations.com',  // Add your production domain
      'https://baonlineexaminations.com'       // Add without www as well
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
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  }
});

app.use(generalLimiter)

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.'
  }
});

// Add debugging middleware for requests
app.use((req, res, next) => {
  console.log(`📥 Request: ${req.method} ${req.path}`);
  next();
});

// Load API routes first (BEFORE static file serving)
const routes = [
  { path: '/api/auth', file: './routes/auth.routes.js', name: 'Auth' },
  { path: '/api/courses', file: './routes/course.routes.js', name: 'Course' },
  { path: '/api/assignments', file: './routes/assignment.routes.js', name: 'Assignment' },
  { path: '/api/quiz', file: './routes/quiz.routes.js', name: 'Quiz' },
  { path: '/api/teacher-review', file: './routes/teacherReview.routes.js', name: 'Teacher Review' },
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

// FIXED: Serve static files with proper configuration
app.use(express.static(distPath, {
  // Set proper cache headers
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',

  // Set proper headers for different file types
  setHeaders: (res, filePath, stat) => {
    const ext = path.extname(filePath).toLowerCase();

    // Set proper MIME types
    switch (ext) {
      case '.js':
      case '.mjs':
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        break;
      case '.css':
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
        break;
      case '.json':
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        break;
      case '.html':
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        break;
      case '.ico':
        res.setHeader('Content-Type', 'image/x-icon');
        break;
      case '.png':
        res.setHeader('Content-Type', 'image/png');
        break;
      case '.jpg':
      case '.jpeg':
        res.setHeader('Content-Type', 'image/jpeg');
        break;
      case '.svg':
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        break;
      case '.woff':
        res.setHeader('Content-Type', 'font/woff');
        break;
      case '.woff2':
        res.setHeader('Content-Type', 'font/woff2');
        break;
      case '.ttf':
        res.setHeader('Content-Type', 'font/ttf');
        break;
      case '.eot':
        res.setHeader('Content-Type', 'application/vnd.ms-fontobject');
        break;
    }

    console.log(`📤 Serving static file: ${path.basename(filePath)} (${ext} -> ${res.getHeader('Content-Type')})`);
  }
}));


app.get('/robots.txt', (req, res) => {
  res.sendFile(path.join(__dirname, 'robots.txt'));
});


app.get('/sitemap.xml', (req, res) => {
  res.sendFile(path.join(__dirname, 'sitemap.xml'));
});


app.get('/register', (req, res) => {
  console.log('📥 /register accessed -> redirecting to /');
  res.redirect(302, '/');
});
// FIXED: Handle client-side routing (SPA fallback) - MOVED AFTER static serving
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

  const isStaticAsset = req.path.startsWith('/assets/') ||
                       req.path.startsWith('/static/') ||
                       req.path.startsWith('/favicon') ||
                       req.path.match(/\.(js|mjs|css|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|map|json|txt|xml)$/i);

  if (isStaticAsset) {
    console.log(`❌ Static asset not found: ${req.path}`);
    return res.status(404).send(`Static asset not found: ${req.path}`);
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

  // Set proper content type for HTML
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

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