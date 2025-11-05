import { getStore } from "@netlify/blobs";
import { authenticateRequest } from "./auth-helper.js";

/**
 * Netlify Function to serve configuration from Blob storage
 * GET /api/config - Returns the current app configuration (public)
 * POST /api/config - Updates the configuration (requires passphrase)
 */
export default async (req, context) => {
  const store = getStore("toddler-config");

  // Handle GET request - return current config
  if (req.method === "GET") {
    try {
      // Try to get config from blob storage
      const config = await store.get("app-config", { type: "json" });

      if (!config) {
        // Return default config if none exists
        const defaultConfig = {
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

        return new Response(JSON.stringify(defaultConfig), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300" // Cache for 5 minutes
          }
        });
      }

      return new Response(JSON.stringify(config), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300"
        }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  // Handle POST request - update config (requires authentication)
  if (req.method === "POST") {
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
          ...authResult.headers
        }
      });
    }

    try {
      const newConfig = await req.json();

      // Add metadata
      newConfig.lastUpdated = new Date().toISOString();

      // Save to blob storage
      await store.setJSON("app-config", newConfig);

      return new Response(JSON.stringify({
        success: true,
        message: "Configuration updated successfully",
        config: newConfig
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...authResult.headers
        }
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  // Handle OPTIONS for CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  // Method not allowed
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" }
  });
};

export const config = {
  path: "/api/config"
};
