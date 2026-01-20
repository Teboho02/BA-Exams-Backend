import dotenv from 'dotenv';
dotenv.config();

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import path from 'path';

// Function to create S3 client with current env variables
const getS3Client = () => {
  return new S3Client({
    region: process.env.AWS_REGION || 'ap-southeast-1',
    endpoint: process.env.LIGHTSAIL_ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    forcePathStyle: false,
  });
};

/**
 * Upload file to Lightsail Object Storage
 * @param {Object} file - Multer file object
 * @param {String} folder - Folder path in bucket (e.g., 'products/uuid')
 * @returns {String} - Public URL of uploaded file
 */
export const uploadToLightsail = async (file, folder = 'uploads') => {
  try {
    const BUCKET_NAME = process.env.LIGHTSAIL_BUCKET_NAME;
    const AWS_REGION = process.env.AWS_REGION;

    // Validate bucket name
    if (!BUCKET_NAME) {
      throw new Error('LIGHTSAIL_BUCKET_NAME is not configured');
    }

    // Generate unique filename
    const fileExtension = path.extname(file.originalname);
    const fileName = `${randomUUID()}${fileExtension}`;
    const key = `${folder}/${fileName}`;

    // Determine content type
    const contentType = file.mimetype || 'application/octet-stream';

    console.log('Uploading to bucket:', BUCKET_NAME);
    console.log('Key:', key);

    // Get S3 client with current credentials
    const s3Client = getS3Client();

    // Upload to Lightsail
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: contentType,
      // ACL: 'public-read', // Commented out - bucket must be configured for public access
    });

    await s3Client.send(command);

    // Return public URL (direct S3 URL, no CDN)
    const publicUrl = `https://${BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${key}`;

    return publicUrl;
  } catch (error) {
    console.error('Error uploading to Lightsail:', error);
    throw new Error('Failed to upload file to storage');
  }
};

/**
 * Upload multiple files to Lightsail
 * @param {Array} files - Array of Multer file objects
 * @param {String} folder - Folder path in bucket
 * @returns {Array} - Array of public URLs
 */
export const uploadMultipleToLightsail = async (files, folder = 'uploads') => {
  try {
    const uploadPromises = files.map(file => uploadToLightsail(file, folder));
    return await Promise.all(uploadPromises);
  } catch (error) {
    console.error('Error uploading multiple files:', error);
    throw new Error('Failed to upload files to storage');
  }
};

/**
 * Delete file from Lightsail Object Storage
 * @param {String} fileUrl - Public URL of the file
 * @returns {Boolean} - Success status
 */
export const deleteFromLightsail = async (fileUrl) => {
  try {
    const BUCKET_NAME = process.env.LIGHTSAIL_BUCKET_NAME;
    const AWS_REGION = process.env.AWS_REGION;

    if (!BUCKET_NAME) {
      throw new Error('LIGHTSAIL_BUCKET_NAME is not configured');
    }

    // Extract key from URL
    const urlPattern = new RegExp(`https://${BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/(.+)`);
    const match = fileUrl.match(urlPattern);
    const key = match ? match[1] : null;

    if (!key) {
      throw new Error('Invalid file URL');
    }

    const s3Client = getS3Client();

    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    return true;
  } catch (error) {
    console.error('Error deleting from Lightsail:', error);
    throw new Error('Failed to delete file from storage');
  }
};

/**
 * Delete multiple files from Lightsail
 * @param {Array} fileUrls - Array of public URLs
 * @returns {Boolean} - Success status
 */
export const deleteMultipleFromLightsail = async (fileUrls) => {
  try {
    const deletePromises = fileUrls.map(url => deleteFromLightsail(url));
    await Promise.all(deletePromises);
    return true;
  } catch (error) {
    console.error('Error deleting multiple files:', error);
    throw new Error('Failed to delete files from storage');
  }
};

export default {
  uploadToLightsail,
  uploadMultipleToLightsail,
  deleteFromLightsail,
  deleteMultipleFromLightsail,
};