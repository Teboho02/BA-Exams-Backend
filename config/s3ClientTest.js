// config/lightsailTest.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { uploadToLightsail } from './s3Client.js';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const testUpload = async () => {
  // Debug: Check if env variables are loaded
  console.log('Environment variables:');
  console.log('AWS_REGION:', process.env.AWS_REGION);
  console.log('LIGHTSAIL_BUCKET_NAME:', process.env.LIGHTSAIL_BUCKET_NAME);
  console.log('LIGHTSAIL_ENDPOINT:', process.env.LIGHTSAIL_ENDPOINT);
  console.log('AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID ? '✓ Set' : '✗ Not set');
  console.log('AWS_SECRET_ACCESS_KEY:', process.env.AWS_SECRET_ACCESS_KEY ? '✓ Set' : '✗ Not set');
  console.log('---');

  if (!process.env.LIGHTSAIL_BUCKET_NAME) {
    console.error('Error: LIGHTSAIL_BUCKET_NAME is not set in .env file');
    return;
  }

  const testFile = {
    buffer: Buffer.from('test content'),
    originalname: 'test.txt',
    mimetype: 'text/plain'
  };
  
  try {
    console.log('Attempting upload...');
    const url = await uploadToLightsail(testFile, 'test');
    console.log('✓ Upload successful:', url);
  } catch (error) {
    console.error('✗ Upload failed:', error.message);
    console.error('Full error:', error);
  }
};

testUpload();