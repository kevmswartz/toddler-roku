import { getStore } from '@netlify/blobs';

export default async (req, context) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const imageStore = getStore({
      name: 'toddler-images',
      siteID: context.site.id,
      token: context.token
    });

    // List all images
    const { blobs } = await imageStore.list({ prefix: 'images/' });

    const images = blobs.map(blob => ({
      key: blob.key,
      url: `${context.site.url}/.netlify/blobs/serve/site/${context.site.id}/toddler-images/${blob.key}`,
      size: blob.size,
      etag: blob.etag,
      metadata: blob.metadata
    }));

    return new Response(JSON.stringify({
      success: true,
      count: images.length,
      images: images
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      }
    });

  } catch (error) {
    console.error('Error listing images:', error);

    return new Response(JSON.stringify({
      error: 'Failed to list images',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config = {
  path: '/api/images'
};
