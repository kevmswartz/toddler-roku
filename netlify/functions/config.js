import { getStore } from "@netlify/blobs";
import { authenticateRequest } from "./auth-helper.js";
import crypto from "crypto";

/**
 * Netlify Function to serve configuration from Blob storage
 * GET /api/config?passphrase=xxx - Returns config for specific passphrase
 * POST /api/config - Updates the configuration (requires passphrase in Authorization header)
 */

/**
 * Hash passphrase to generate blob key
 * This keeps passphrases private in blob storage
 */
function hashPassphrase(passphrase) {
  // Normalize: lowercase, trim, single spaces
  const normalized = passphrase.toLowerCase().trim().replace(/\s+/g, ' ');
  // Use SHA-256 hash
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 32);
}

/**
 * CORS headers to include in all responses
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

/**
 * Get default configuration based on type
 */
function getDefaultConfig(type = 'app-config') {
  if (type === 'rooms') {
    return {
      rooms: [],
      settings: {
        autoDetect: false,
        scanInterval: 10000,
        rssiSampleSize: 3,
        detectionMode: "manual",
        fallbackRoom: null
      },
      version: "1.0.0",
      lastUpdated: new Date().toISOString()
    };
  }

  // Default app-config
  return {
    tabs: [
      {
        id: "remote",
        label: "Remote",
        icon: "🎮",
        buttons: [
          {
            id: "findRokuButton",
            emoji: "🔍",
            handler: "discoverRoku"
          },
          {
            id: "homeButton",
            emoji: "🏠",
            handler: "sendKey",
            args: ["Home"]
          },
          {
            id: "backButton",
            emoji: "⟵",
            handler: "sendKey",
            args: ["Back"]
          },
          {
            id: "playPauseButton",
            emoji: "⏯️",
            handler: "sendKey",
            args: ["Play"]
          },
          {
            id: "powerButton",
            emoji: "🔘",
            handler: "sendKey",
            args: ["PowerOff"]
          }
        ]
      }
    ],
    version: "1.0.0",
    lastUpdated: new Date().toISOString()
  };
}

export default async (req, context) => {
  const store = getStore("toddler-config");

  // Handle GET request - return current config
  if (req.method === "GET") {
    try {
      // Get passphrase and type from query parameters
      const url = new URL(req.url);
      const passphrase = url.searchParams.get('passphrase');
      const configType = url.searchParams.get('type') || 'app-config'; // Default to app-config

      // Validate config type
      if (configType !== 'app-config' && configType !== 'rooms') {
        return new Response(JSON.stringify({
          error: `Invalid config type: ${configType}. Must be 'app-config' or 'rooms'`
        }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS
          }
        });
      }

      // Determine which config to load
      let blobKey;
      if (passphrase) {
        // Use passphrase-specific config with type suffix
        blobKey = `${configType}-${hashPassphrase(passphrase)}`;
      } else {
        // Use default config (for backwards compatibility, app-config uses old key)
        blobKey = configType === 'app-config' ? "app-config" : "rooms-default";
      }

      // Try to get config from blob storage
      const config = await store.get(blobKey, { type: "json" });

      if (!config) {
        // Return default config if none exists for this passphrase
        const defaultConfig = getDefaultConfig(configType);

        return new Response(JSON.stringify(defaultConfig), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store, no-cache, must-revalidate", // No caching - always fresh!
            ...CORS_HEADERS
          }
        });
      }

      return new Response(JSON.stringify(config), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate", // No caching - always fresh!
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

  // Handle POST request - update config (requires authentication)
  if (req.method === "POST") {
    // Authenticate request (passphrase is in Authorization header)
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
      // Extract passphrase from Authorization header
      const authHeader = req.headers.get('authorization');
      const passphrase = authHeader.replace(/^Bearer\s+/i, '');

      // Get config type from query parameter
      const url = new URL(req.url);
      const configType = url.searchParams.get('type') || 'app-config';

      // Validate config type
      if (configType !== 'app-config' && configType !== 'rooms') {
        return new Response(JSON.stringify({
          success: false,
          error: `Invalid config type: ${configType}. Must be 'app-config' or 'rooms'`
        }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS
          }
        });
      }

      // Generate blob key from passphrase with type prefix
      const blobKey = `${configType}-${hashPassphrase(passphrase)}`;

      const newConfig = await req.json();

      // Add metadata
      newConfig.lastUpdated = new Date().toISOString();
      newConfig.configType = configType; // Add type to config for reference

      // Save to blob storage using passphrase-specific key
      await store.setJSON(blobKey, newConfig);

      return new Response(JSON.stringify({
        success: true,
        message: `${configType} configuration updated successfully`,
        config: newConfig,
        configType: configType,
        passphrase_hash: hashPassphrase(passphrase) // Return hash for debugging
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

  // Method not allowed
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS
    }
  });
};

export const config = {
  path: "/api/config"
};
