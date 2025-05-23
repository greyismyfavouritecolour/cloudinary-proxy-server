// Secure Cloudinary Proxy Server for Figma Plugin
// This server handles signed uploads to keep your API credentials safe

const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');
require('dotenv').config();

const app = express();

// Enhanced CORS configuration for Figma plugins
app.use(cors({
  origin: '*',
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: false,
  preflightContinue: false,
  optionsSuccessStatus: 200
}));

// Handle preflight requests explicitly
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.sendStatus(200);
});

// Configure multer for file uploads (memory storage)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Configure Cloudinary with environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Verify Cloudinary configuration on startup
console.log('🔧 Verifying Cloudinary configuration...');
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('❌ Missing Cloudinary credentials in .env file');
  process.exit(1);
}
console.log(`✅ Cloudinary configured for: ${process.env.CLOUDINARY_CLOUD_NAME}`);

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  
  if (!token) {
    return res.status(401).json({ 
      success: false, 
      error: 'Access token required' 
    });
  }
  
  if (token !== process.env.AUTH_TOKEN) {
    return res.status(403).json({ 
      success: false, 
      error: 'Invalid access token' 
    });
  }
  
  next();
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.json({ 
    success: true, 
    message: 'Cloudinary proxy server is running',
    timestamp: new Date().toISOString()
  });
});

// Main upload endpoint
app.post('/upload', authenticateToken, upload.single('image'), async (req, res) => {
  // Set CORS headers for this response
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  console.log('\n🚀 New upload request received');
  
  try {
    // Validate file upload
    if (!req.file) {
      console.log('❌ No file uploaded');
      return res.status(400).json({ 
        success: false, 
        error: 'No image file provided' 
      });
    }
    
    // Parse metadata and filename
    const metadata = JSON.parse(req.body.metadata || '{}');
    const filename = req.body.filename || 'unnamed';
    
    console.log(`📁 Filename: ${filename}`);
    console.log(`📊 Metadata:`, metadata);
    console.log(`📏 File size: ${(req.file.size / 1024).toFixed(2)}KB`);
    
    // Prepare context string for Cloudinary
    const contextEntries = Object.entries(metadata)
      .filter(([key, value]) => key !== 'timestamp' && key !== 'baseName' && value)
      .map(([key, value]) => `${key}=${value}`);
    
    const contextString = contextEntries.join('|');
    console.log(`🏷️  Context: ${contextString}`);
    
    // Upload to Cloudinary using a Promise wrapper
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          // Upload options
          public_id: filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, ''),
          folder: process.env.UPLOAD_FOLDER || 'figma-exports',
          context: contextString,
          resource_type: 'image',
          
          // Optional: Add transformations
          // quality: 'auto:good',
          // format: 'auto',
          
          // Optional: Add tags
          tags: ['figma', 'metadata-export'],
          
          // Overwrite files with same public_id
          overwrite: true,
          
          // Generate unique filename if conflict
          unique_filename: false,
          use_filename: true
        },
        (error, result) => {
          if (error) {
            console.error('❌ Cloudinary upload error:', error);
            reject(error);
          } else {
            console.log(`✅ Upload successful: ${result.secure_url}`);
            resolve(result);
          }
        }
      );
      
      // Pipe the file buffer to Cloudinary
      uploadStream.end(req.file.buffer);
    });
    
    // Return success response
    res.json({
      success: true,
      url: uploadResult.secure_url,
      public_id: uploadResult.public_id,
      width: uploadResult.width,
      height: uploadResult.height,
      format: uploadResult.format,
      bytes: uploadResult.bytes,
      created_at: uploadResult.created_at
    });
    
  } catch (error) {
    console.error('❌ Upload failed:', error);
    
    // Return appropriate error response
    if (error.http_code) {
      // Cloudinary specific error
      res.status(400).json({
        success: false,
        error: `Cloudinary error: ${error.message}`,
        details: error.error?.message || 'Unknown Cloudinary error'
      });
    } else {
      // General server error
      res.status(500).json({
        success: false,
        error: 'Upload failed',
        details: error.message
      });
    }
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('💥 Unhandled error:', error);
  res.header('Access-Control-Allow-Origin', '*');
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    available_endpoints: [
      'GET /health - Health check',
      'POST /upload - Upload images'
    ]
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n🎉 Cloudinary Proxy Server Started Successfully!');
  console.log(`📍 Server running on: http://localhost:${PORT}`);
  console.log(`🔒 Authentication required: Bearer ${process.env.AUTH_TOKEN}`);
  console.log(`📁 Upload folder: ${process.env.UPLOAD_FOLDER || 'figma-exports'}`);
  console.log('\n📋 Available endpoints:');
  console.log(`   GET  http://localhost:${PORT}/health`);
  console.log(`   POST http://localhost:${PORT}/upload`);
  console.log('\n🛑 Press Ctrl+C to stop the server\n');
});