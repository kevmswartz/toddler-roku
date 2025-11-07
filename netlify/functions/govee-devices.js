import { getStore } from "@netlify/blobs";
import { authenticateRequest } from "./auth-helper.js";
import crypto from "crypto";

/**
 * Netlify Function to store and serve Govee device discovery results
 * GET /api/config/govee-devices.json?passphrase=xxx - Returns Govee device list
 * POST /api/config/govee-devices.json - Updates Govee device list (requires passphrase in Authorization header)
 */

function hashPassphrase(passphrase) {
  const normalized = passphrase.toLowerCase().trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 32);
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

export default async (req, context) => {
  const store = getStore("toddler-config");

  // Handle GET request - return Govee device list
  if (req.method === "GET") {
    try {
      const url = new URL(req.url);
      const passphrase = url.searchParams.get('passphrase');

      if (!passphrase) {
        return new Response(JSON.stringify({
          error: "Passphrase required"
        }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS
          }
        });
      }

      const blobKey = `govee-devices-${hashPassphrase(passphrase)}`;
      const deviceList = await store.get(blobKey, { type: "json" });

      if (!deviceList) {
        return new Response(JSON.stringify({
          devices: [],
          timestamp: new Date().toISOString(),
          message: "No Govee devices discovered yet"
        }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            ...CORS_HEADERS
          }
        });
      }

      return new Response(JSON.stringify(deviceList), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          ...CORS_HEADERS
        }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS
        }
      });
    }
  }

  // Handle POST request - update Govee device list (requires authentication)
  if (req.method === "POST") {
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
      const authHeader = req.headers.get('authorization');
      const passphrase = authHeader.replace(/^Bearer\s+/i, '');
      const blobKey = `govee-devices-${hashPassphrase(passphrase)}`;

      const deviceData = await req.json();

      // Add metadata
      deviceData.timestamp = new Date().toISOString();
      deviceData.type = 'govee-discovery';

      await store.setJSON(blobKey, deviceData);

      return new Response(JSON.stringify({
        success: true,
        message: "Govee device list saved successfully",
        deviceCount: deviceData.devices?.length || 0
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
  }

  // Handle OPTIONS for CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS
    }
  });
};

export const config = {
  path: "/api/config/govee-devices.json"
};
