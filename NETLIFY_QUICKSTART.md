# Netlify Configuration Service - Quick Start

This guide explains how to use Netlify to host and manage your Toddler Phone Control configuration files.

## What This Does

**Netlify hosts 2 things:**
1. A simple API for your config JSON (at `/api/config`)
2. A basic landing page explaining the service

**What you'll see at toddler-phone-control.netlify.app:**
- Simple purple gradient landing page
- GitHub link
- Test passphrase button
- API info
- **NOT the full app!** Just a landing page and API.

**Your Tauri app (the actual remote control):**
- Runs locally on your desktop/phone/tablet
- Fetches config FROM Netlify's API
- Updates automatically when you change the config via API

## Setup (5 minutes)

### Step 1: Deploy to Netlify

1. Go to [netlify.com](https://netlify.com) and sign in
2. Click **"Add new site"** → **"Import an existing project"**
3. Choose **GitHub** and select `kevmswartz/toddler-phone-control`
4. Netlify auto-detects settings from `netlify.toml` - just click **Deploy**
5. Your site will be at: `https://toddler-phone-control.netlify.app`

### Step 2: Set Your Passphrase (Optional)

**Default passphrase:** `blue mountain coffee morning sunshine`

To change it:
1. In Netlify dashboard → **Site Settings** → **Environment Variables**
2. Click **Add a variable**
3. Key: `CONFIG_PASSPHRASE`
4. Value: Your five words (e.g., `rainbow unicorn cookie monster disco`)
5. Click **Save** and **redeploy** the site

### Step 3: Upload Your Initial Config

Use this command to upload your config (replace passphrase if you changed it):

```bash
curl -X POST https://toddler-phone-control.netlify.app/api/config-import \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer blue mountain coffee morning sunshine" \
  -d '{
    "key": "app-config",
    "data": {
      "tabs": [
        {
          "id": "remote",
          "label": "Remote",
          "icon": "🎮",
          "buttons": [
            {
              "id": "homeButton",
              "emoji": "🏠",
              "handler": "sendKey",
              "args": ["Home"]
            }
          ]
        }
      ]
    }
  }'
```

Or use the helper script:
```bash
node netlify/init-config.js public/config/app-config.json "your passphrase"
```

### Step 4: Point Your App to Netlify

In your app settings (gear icon + PIN):
1. Set **Remote JSON URL** to: `https://toddler-phone-control.netlify.app/api/config`
2. Click **Save URL & Refresh**
3. Your app now fetches config from Netlify!

## How to Modify Your Config

There are 3 simple steps:

1. **Edit** your `public/config/app-config.json` locally
2. **Upload** to Netlify via API (see commands below)
3. **Refresh** your app - it fetches the new config automatically!

### Option 1: Via API (Command Line)

Update the entire config:
```bash
curl -X POST https://toddler-phone-control.netlify.app/api/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer blue mountain coffee morning sunshine" \
  -d @public/config/app-config.json
```

Or inline:
```bash
curl -X POST https://toddler-phone-control.netlify.app/api/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer blue mountain coffee morning sunshine" \
  -d '{
    "tabs": [
      {
        "id": "remote",
        "label": "Remote",
        "icon": "🎮",
        "buttons": [...]
      }
    ]
  }'
```

### Option 2: Via JavaScript/Browser

```javascript
fetch('https://toddler-phone-control.netlify.app/api/config', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer blue mountain coffee morning sunshine'
  },
  body: JSON.stringify({
    tabs: [
      {
        id: 'remote',
        label: 'Remote',
        icon: '🎮',
        buttons: [
          {
            id: 'homeButton',
            emoji: '🏠',
            handler: 'sendKey',
            args: ['Home']
          }
        ]
      }
    ]
  })
})
.then(r => r.json())
.then(data => console.log('Updated!', data));
```

### Option 3: Build a Web UI

Create a simple HTML page to edit your config:
1. Fetch current config: `GET /api/config`
2. Edit in a form or JSON editor
3. Save changes: `POST /api/config` with Authorization header

## Workflow

**Normal workflow:**
1. Edit `public/config/app-config.json` locally
2. Upload to Netlify via API (see above)
3. App fetches new config automatically

**Benefits:**
- No need to rebuild your app
- Changes take effect immediately
- Works offline (falls back to bundled config)
- No CDN costs

## Test Your Setup

**Test passphrase:**
Visit: `https://toddler-phone-control.netlify.app/test-auth.html`

**Fetch current config:**
```bash
curl https://toddler-phone-control.netlify.app/api/config
```

**List all stored configs:**
```bash
curl https://toddler-phone-control.netlify.app/api/config-list
```

## Security

- **Passphrase required** for all updates (POST endpoints)
- **Rate limited**: 5 attempts per hour per IP
- **GET is public**: Anyone can fetch your config (by design)
- **Change default passphrase** if sharing publicly

## Costs

**FREE!** Netlify's free tier includes:
- 100GB bandwidth/month
- 125k function invocations/month
- Netlify Blobs storage

More than enough for a family app.

## Alternative: Local Only

Don't want to use Netlify? No problem:
1. Don't set a remote URL in app settings
2. App uses bundled `public/config/app-config.json`
3. Rebuild app when you want to change config
4. Fully offline, no internet needed

## Troubleshooting

**"Unauthorized" error:**
- Check your passphrase matches exactly
- Visit `/test-auth.html` to verify

**"Too many attempts" error:**
- Wait 1 hour or check `X-RateLimit-Reset` header
- Make sure you're using the correct passphrase

**Config not updating in app:**
- Check app's Remote JSON URL setting
- Verify URL is: `https://toddler-phone-control.netlify.app/api/config`
- Click "Refresh from Remote" in app settings

**Netlify functions not working:**
- Check function logs in Netlify dashboard
- Ensure `@netlify/blobs` is enabled (automatic)

## Next Steps

1. Deploy to Netlify ✅
2. Set custom passphrase (optional)
3. Upload initial config
4. Point app to Netlify URL
5. Edit configs via API as needed

For detailed API docs, see `netlify/README.md`.
