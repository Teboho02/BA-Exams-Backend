// routes/upload.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import { uploadToLightsail, deleteFromLightsail } from '../config/s3Client.js';

const router = express.Router();

// Configure multer to store files in memory
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'), false);
    }
    cb(null, true);
  },
});

// Upload endpoint
router.post('/', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided',
      });
    }

    console.log(
      `📤 Uploading image: ${req.file.originalname} (${req.file.size} bytes)`
    );

    // Upload using Lightsail storage abstraction
    const publicUrl = await uploadToLightsail(req.file, 'images');

    console.log(`✅ Image uploaded successfully: ${publicUrl}`);

    res.json({
      success: true,
      url: publicUrl,
      filename: path.basename(publicUrl),
    });
  } catch (error) {
    console.error('❌ Upload error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to upload image',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : undefined,
    });
  }
});

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Upload service is running',
    maxFileSize: '5MB',
    allowedTypes: ['image/*'],
  });
});

// Multer + validation error handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 5MB',
      });
    }

    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  if (err.message === 'Only image files are allowed') {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  next(err);
});

export default router;
