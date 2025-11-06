import { getStore } from "@netlify/blobs";

/**
 * CORS headers to include in all responses
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

/**
 * Netlify Function to list all stored configurations
 * GET /api/config-list - Returns list of all config keys and metadata
 */
export default async (req, context) => {
  // Handle OPTIONS for CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS
    });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS
      }
    });
  }

  try {
    const store = getStore("toddler-config");

    // List all blobs in the store
    const { blobs } = await store.list();

    // Get metadata for each config
    const configs = await Promise.all(
      blobs.map(async (blob) => {
        const metadata = await store.getMetadata(blob.key);
        return {
          key: blob.key,
          size: blob.size,
          etag: blob.etag,
          metadata: metadata || {}
        };
      })
    );

    return new Response(JSON.stringify({
      success: true,
      count: configs.length,
      configs: configs
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        ...CORS_HEADERS
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS
      }
    });
  }
};

export const config = {
  path: "/api/config-list"
};
