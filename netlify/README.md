# Toddler Phone Control - Netlify Deployment

This directory contains the Netlify configuration for hosting the Toddler Phone Control configuration service.

## What This Does

The Netlify deployment provides:

1. **Static Homepage** - A landing page that links to the GitHub repository
2. **API Endpoints** - Serverless functions to manage configuration via Netlify Blobs
3. **Blob Storage** - Cloud storage for JSON configuration files that can be updated without rebuilding the app

## Structure

```
netlify/
├── public/              # Static files served at root
│   └── index.html      # Homepage
├── functions/           # Netlify serverless functions
│   ├── config.js       # GET/POST app configuration
│   ├── config-list.js  # List all stored configs
│   ├── config-import.js # Import config to blob storage
│   └── package.json    # Function dependencies
└── README.md           # This file
```

## API Endpoints

### GET /api/config
Returns the current app configuration from blob storage.

**Response:**
```json
{
  "tabs": [...],
  "version": "1.0.0",
  "lastUpdated": "2025-11-05T12:00:00Z"
}
```

### POST /api/config
Updates the configuration in blob storage. **Requires passphrase authentication.**

**Headers:**
- `Authorization: Bearer your-five-word-passphrase`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "tabs": [...]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Configuration updated successfully",
  "config": {...}
}
```

**Example:**
```bash
curl -X POST https://toddler-phone-control.netlify.app/api/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer blue mountain coffee morning sunshine" \
  -d '{"tabs": [...]}'
```

### GET /api/config-list
Lists all stored configurations.

**Response:**
```json
{
  "success": true,
  "count": 1,
  "configs": [
    {
      "key": "app-config",
      "size": 5302,
      "etag": "...",
      "metadata": {}
    }
  ]
}
```

### POST /api/config-import
Imports a configuration with a specific key. **Requires passphrase authentication.**

**Headers:**
- `Authorization: Bearer your-five-word-passphrase`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "key": "my-config",
  "data": {
    "tabs": [...]
  }
}
```

## Deployment

### Prerequisites

1. A Netlify account
2. The Netlify CLI (optional): `npm install -g netlify-cli`

### Deploy to Netlify

1. **Connect to GitHub:**
   - Go to [Netlify](https://netlify.com)
   - Click "Add new site" → "Import an existing project"
   - Choose GitHub and select `kevmswartz/toddler-phone-control`

2. **Configure Build Settings:**
   - Build command: (leave empty - no build needed)
   - Publish directory: `netlify/public`
   - Functions directory: `netlify/functions`

3. **Deploy:**
   - Click "Deploy site"
   - Netlify will read `netlify.toml` automatically

### Environment Variables

**Optional:**
- `CONFIG_PASSPHRASE` - Custom 5-word passphrase for authentication
  - Default: `blue mountain coffee morning sunshine`
  - Set in Netlify dashboard: Site Settings → Environment Variables
  - Format: Five words separated by spaces (case-insensitive)

## Using the API in Your App

Update your app's configuration to point to the Netlify endpoint:

```javascript
const CONFIG_URL = 'https://toddler-phone-control.netlify.app/api/config';

// Fetch configuration
async function loadConfig() {
  const response = await fetch(CONFIG_URL);
  const config = await response.json();
  return config;
}
```

## Initializing Blob Storage

To upload your initial configuration, you'll need your passphrase (default: `blue mountain coffee morning sunshine`):

```bash
curl -X POST https://toddler-phone-control.netlify.app/api/config-import \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer blue mountain coffee morning sunshine" \
  -d '{"key": "app-config", "data": {...}}'
```

Or use the import endpoint with JavaScript:

```javascript
fetch('https://toddler-phone-control.netlify.app/api/config-import', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer blue mountain coffee morning sunshine'
  },
  body: JSON.stringify({
    key: 'app-config',
    data: {
      tabs: [...]
    }
  })
});
```

## Local Development

Test functions locally with Netlify CLI:

```bash
# Install dependencies
cd netlify/functions
npm install

# Return to root
cd ../..

# Start local dev server
netlify dev
```

This will start a local server at `http://localhost:8888` with functions at `http://localhost:8888/api/*`.

## Benefits

- **No App Rebuild:** Update configuration remotely without recompiling
- **Version Control:** Store different configs for testing/production
- **Easy Rollback:** Keep previous versions in blob storage
- **No Infrastructure:** Fully serverless, scales automatically
- **Free Tier:** Netlify's free tier includes 100GB bandwidth and 125k function invocations/month

## CORS Configuration

CORS is configured in `netlify.toml` to allow requests from any origin:

```toml
[[headers]]
  for = "/api/*"
  [headers.values]
    Access-Control-Allow-Origin = "*"
    Access-Control-Allow-Methods = "GET, POST, PUT, DELETE, OPTIONS"
    Access-Control-Allow-Headers = "Content-Type"
```

For production, consider restricting origins to your app's domains.

## Caching

- **Config endpoint:** Cached for 5 minutes (`Cache-Control: public, max-age=300`)
- **List endpoint:** Not cached (`Cache-Control: no-cache`)

## Security & Authentication

### Passphrase Authentication

All POST endpoints (config updates, imports) require a 5-word passphrase:

**Default Passphrase:** `blue mountain coffee morning sunshine`

**To set a custom passphrase:**
1. Go to Netlify dashboard → Site Settings → Environment Variables
2. Add variable: `CONFIG_PASSPHRASE`
3. Value: Your five words separated by spaces
4. Redeploy the site

**Usage:**
```bash
curl -X POST https://your-site.netlify.app/api/config \
  -H "Authorization: Bearer blue mountain coffee morning sunshine" \
  -H "Content-Type: application/json" \
  -d '{"tabs": [...]}'
```

**Test your passphrase:**
Visit `/test-auth.html` on your deployed site to verify your passphrase.

### Rate Limiting

Automatic rate limiting protects against brute force attacks:

- **Limit:** 5 failed attempts per hour per IP address
- **Window:** 1 hour rolling window
- **Response:** HTTP 429 with retry-after information
- **Headers:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

Rate limit counters are stored in Netlify Blobs and automatically expire.

### Additional Security Recommendations

For production deployments:

1. **Change the default passphrase** via environment variable
2. **Restrict CORS** to your app's specific domains in `netlify.toml`
3. **Monitor function logs** for suspicious activity
4. **Use HTTPS only** (Netlify enforces this by default)
5. **Rotate passphrase periodically** if shared with multiple people

## Troubleshooting

**Functions not working:**
- Check the Netlify function logs in the dashboard
- Ensure `@netlify/blobs` is installed in `netlify/functions/package.json`

**CORS errors:**
- Verify `netlify.toml` headers are configured
- Check that the request includes proper `Content-Type` header

**Blob storage not found:**
- Ensure Netlify Blobs are enabled in your site settings
- Check that you're using the correct store name (`toddler-config`)
