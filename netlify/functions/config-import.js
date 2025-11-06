import { getStore } from "@netlify/blobs";
import { authenticateRequest } from "./auth-helper.js";

/**
 * CORS headers to include in all responses
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

/**
 * Netlify Function to import configuration to Blob storage
 * POST /api/config-import - Imports a new config with a specific key (requires passphrase)
 * Body: { key: "config-name", data: {...} }
 */
export default async (req, context) => {
  // Handle OPTIONS for CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS
      }
    });
  }

  // Authenticate request
  const authResult = await authenticateRequest(req);

  if (!authResult.success) {
    return new Response(JSON.stringify({
      success: false,
      error: authResult.error
    }), {
      status: authResult.status,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
        ...authResult.headers
      }
    });
  }

  try {
    const { key, data } = await req.json();

    if (!key || !data) {
      return new Response(JSON.stringify({
        success: false,
        error: "Missing required fields: key and data"
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS
        }
      });
    }

    const store = getStore("toddler-config");

    // Add metadata
    const configWithMeta = {
      ...data,
      importedAt: new Date().toISOString(),
      key: key
    };

    // Save to blob storage
    await store.setJSON(key, configWithMeta);

    return new Response(JSON.stringify({
      success: true,
      message: `Configuration '${key}' imported successfully`,
      config: configWithMeta
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
        ...authResult.headers
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
  path: "/api/config-import"
};
