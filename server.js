// Secure Cloudinary Proxy Server for Figma Plugin
// This server handles signed uploads to keep your API credentials safe
// + Claude API proxy for content localization

const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');
const fetch = require('node-fetch'); // Add this for Claude API calls
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: '*', // Allow all origins for Figma plugin
  methods: ['POST', 'GET'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

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
  res.json({ 
    success: true, 
    message: 'Cloudinary proxy server is running',
    timestamp: new Date().toISOString()
  });
});

// NEW: Claude API endpoint for content localization
app.post('/api/claude', async (req, res) => {
  console.log('\n🧠 Claude API request received');
  
  try {
    const { prompt, fieldType, targetLocale, apiKey } = req.body;
    
    // Validate required fields
    if (!prompt || !fieldType || !targetLocale || !apiKey) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ 
        error: 'Missing required fields: prompt, fieldType, targetLocale, apiKey' 
      });
    }
    
    console.log(`🎯 Localizing ${fieldType} for ${targetLocale}`);
    console.log(`📝 Prompt: ${prompt.substring(0, 100)}...`);
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Claude API Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `Claude API error: ${response.status} ${response.statusText}`,
        details: errorText
      });
    }
    
    const data = await response.json();
    const result = data.content[0].text.trim();
    
    console.log(`✅ Claude response: ${result}`);
    res.json({ text: result });
    
  } catch (error) {
    console.error('❌ Claude proxy error:', error);
    res.status(500).json({ 
      error: 'Proxy server error', 
      details: error.message 
    });
  }
});

// Main upload endpoint
app.post('/upload', authenticateToken, upload.single('image'), async (req, res) => {
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
    
    // Extract MPVID and setup folder structure
    const mpvid = metadata.MPVID || metadata.baseName || 'unknown';
    const targetFolder = process.env.UPLOAD_FOLDER || 'figma-exports';
    const fullFolder = `${targetFolder}/${mpvid}`;
    
    // Separate built-in fields from context metadata
    const builtInFields = {};
    const contextData = {};
    
    // Handle built-in Cloudinary fields
    if (metadata['context.custom.title']) {
      builtInFields.caption = metadata['context.custom.title'];
    }

    if (metadata['context.custom.alt']) {
      builtInFields.alt = metadata['context.custom.alt'];
    }

    // Handle contextual metadata (everything else)
    Object.entries(metadata).forEach(([key, value]) => {
      if (!key.startsWith('context.custom.') && 
          key !== 'timestamp' && 
          key !== 'baseName' && 
          value) {
        contextData[key] = value;
      }
    });
    
    const contextString = Object.entries(contextData)
      .map(([key, value]) => `${key}=${value}`)
      .join('|');
    
    console.log(`🏷️  Built-in fields:`, builtInFields);
    console.log(`📁 Target folder: ${fullFolder}`);
    console.log(`🏷️  Context: ${contextString}`);
    
    // Upload to Cloudinary using a Promise wrapper
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadOptions = {
        // Upload options
        public_id: filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, ''),
        folder: fullFolder,
        resource_type: 'image',
        
        // Contextual metadata
        context: contextString,
        
        // Optional: Add tags
        tags: ['figma', 'metadata-export', mpvid].filter(Boolean),
        
        // Overwrite files with same public_id
        overwrite: true,
        
        // Generate unique filename if conflict
        unique_filename: false,
        use_filename: true,
        
        // Built-in metadata fields
        ...builtInFields  // Spread the built-in fields
      };

      console.log('🚀 Upload options:', JSON.stringify(uploadOptions, null, 2));
      
      const uploadStream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, result) => {
          if (error) {
            console.error('❌ Cloudinary upload error:', error);
            reject(error);
          } else {
            console.log(`✅ Upload successful: ${result.secure_url}`);
            console.log(`📁 Uploaded to folder: ${fullFolder}`);
            console.log(`📝 Caption: ${result.caption || 'None'}`);
            console.log(`📝 Alt text: ${result.alt || 'None'}`);
            console.log(`🏷️  Tags: ${result.tags ? result.tags.join(', ') : 'None'}`);
            console.log('📋 Full result:', JSON.stringify(result, null, 2));
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
      created_at: uploadResult.created_at,
      caption: uploadResult.caption,
      alt: uploadResult.alt,
      context: uploadResult.context,
      tags: uploadResult.tags
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
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    available_endpoints: [
      'GET /health - Health check',
      'POST /upload - Upload images',
      'POST /api/claude - Claude API proxy'  // Added this
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
  console.log(`   POST http://localhost:${PORT}/api/claude`);  // Added this
  console.log('\n🛑 Press Ctrl+C to stop the server\n');
});