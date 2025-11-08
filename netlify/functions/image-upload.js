import { getStore } from '@netlify/blobs';
import { verifyAuth } from './auth-helper.js';

export default async (req, context) => {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Verify authentication
    const authResult = await verifyAuth(req, context);
    if (!authResult.authorized) {
      return new Response(JSON.stringify({ error: authResult.message }), {
        status: authResult.status,
        headers: authResult.headers
      });
    }

    // Get the uploaded file from FormData
    const formData = await req.formData();
    const file = formData.get('image');

    if (!file) {
      return new Response(JSON.stringify({ error: 'No image file provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      return new Response(JSON.stringify({
        error: 'Invalid file type. Allowed: JPG, PNG, WEBP, GIF'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return new Response(JSON.stringify({
        error: 'File too large. Maximum size: 10MB'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const extension = file.name.split('.').pop() || 'png';
    const sanitizedName = file.name
      .replace(/\.[^/.]+$/, '') // Remove extension
      .replace(/[^a-z0-9]/gi, '-') // Replace non-alphanumeric with dash
      .toLowerCase()
      .substring(0, 50); // Limit length

    const blobKey = `images/${timestamp}-${sanitizedName}.${extension}`;

    // Upload to Netlify Blobs
    const imageStore = getStore({
      name: 'toddler-images',
      siteID: context.site.id,
      token: context.token
    });

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Store the image
    await imageStore.set(blobKey, buffer, {
      metadata: {
        contentType: file.type,
        originalName: file.name,
        uploadedAt: new Date().toISOString()
      }
    });

    // Generate public URL
    const imageUrl = `${context.site.url}/.netlify/blobs/serve/site/${context.site.id}/toddler-images/${blobKey}`;

    return new Response(JSON.stringify({
      success: true,
      url: imageUrl,
      key: blobKey,
      name: file.name,
      size: file.size,
      type: file.type
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('Image upload error:', error);

    return new Response(JSON.stringify({
      error: 'Failed to upload image',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config = {
  path: '/api/upload-image'
};
