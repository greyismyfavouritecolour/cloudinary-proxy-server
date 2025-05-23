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
    
    // Separate built-in fields from context metadata
    const builtInFields = {};
    const contextData = {};
    
    // Handle built-in Cloudinary fields
    if (metadata['Title (caption)']) {
      builtInFields.caption = metadata['Title (caption)'];
    }
    
    if (metadata['Description (alt)']) {
      builtInFields.alt = metadata['Description (alt)'];
    }
    
    // Handle contextual metadata (everything else)
    Object.entries(metadata).forEach(([key, value]) => {
      if (key !== 'Title (caption)' && key !== 'Description (alt)' && 
          key !== 'timestamp' && key !== 'baseName' && value) {
        contextData[key] = value;
      }
    });
    
    const contextString = Object.entries(contextData)
      .map(([key, value]) => `${key}=${value}`)
      .join('|');
    
    console.log(`🏷️  Built-in fields:`, builtInFields);
    console.log(`🏷️  Context: ${contextString}`);
    
    // Upload to Cloudinary using a Promise wrapper
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadOptions = {
        // Upload options
        public_id: filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, ''),
        folder: process.env.UPLOAD_FOLDER || 'figma-exports',
        resource_type: 'image',
        
        // Built-in metadata fields
        ...builtInFields,
        
        // Contextual metadata
        context: contextString,
        
        // Optional: Add tags
        tags: ['figma', 'metadata-export'],
        
        // Overwrite files with same public_id
        overwrite: true,
        
        // Generate unique filename if conflict
        unique_filename: false,
        use_filename: true
      };
      
      const uploadStream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, result) => {
          if (error) {
            console.error('❌ Cloudinary upload error:', error);
            reject(error);
          } else {
            console.log(`✅ Upload successful: ${result.secure_url}`);
            console.log(`📝 Caption: ${result.caption || 'None'}`);
            console.log(`📝 Alt text: ${result.alt || 'None'}`);
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
      alt: uploadResult.alt
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