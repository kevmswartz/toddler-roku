# Bunny.net CDN Setup Guide

This guide explains how to migrate your app images (thumbnails, logos, etc.) from bundled local files to Bunny.net CDN for easier updates and smaller app size.

## Why Use a CDN?

**Benefits:**
- **Smaller app size** - Images aren't bundled into the executable/APK
- **Easy updates** - Change images without rebuilding the app
- **Fast loading** - Bunny.net's global CDN is optimized for speed
- **Cost effective** - Bunny.net is one of the cheapest CDNs available

**Drawbacks:**
- Requires internet connection to load images
- Small monthly cost (~$1-5/month for typical usage)

## Step 1: Create Bunny.net Account

1. Go to https://bunny.net
2. Sign up for a free account
3. Verify your email

## Step 2: Create a Storage Zone

1. In Bunny.net dashboard, go to **Storage** > **Add Storage Zone**
2. Settings:
   - **Name**: `roku-control-assets` (or your preferred name)
   - **Region**: Choose closest to your location (e.g., "New York" for US East)
   - **Replication**: Leave off (not needed for small project)
3. Click **Add Storage Zone**

## Step 3: Upload Your Images

### Current Images to Upload

Your app currently has these local images in `public/`:
```
06d8Po5VgMWjpiRU0RpZoul-18.webp         (Disney+ thumbnail)
f7c0cf5003624d98fbe69b2156453e9c.webp   (Paramount+ thumbnail)
Gemini_Generated_Image_jf53kxjf53kxjf53.png  (Fly button)
0003800024848.webp                      (Unknown - check usage)
```

### Upload Process

**Option A: Web Interface (Easiest)**
1. In Storage Zone, click **Upload Files**
2. Create folders for organization:
   - `thumbnails/` - For app thumbnails
   - `buttons/` - For button images
   - `logos/` - For app logos
3. Upload files with descriptive names:
   - `disney-plus-thumbnail.webp` (instead of `06d8Po5VgMWjpiRU0RpZoul-18.webp`)
   - `paramount-plus-thumbnail.webp`
   - `fly-button.png`

**Option B: FTP Upload (For bulk uploads)**
1. Get FTP credentials from Storage Zone settings
2. Use FileZilla or any FTP client
3. Connect and upload organized folders

## Step 4: Get Your CDN URL

After creating the storage zone, Bunny.net automatically creates a Pull Zone (CDN):

1. Go to **Pull Zones** in dashboard
2. Find your storage zone's pull zone (same name)
3. Copy the **CDN URL**, it looks like:
   ```
   https://roku-control-assets.b-cdn.net
   ```

## Step 5: Update default.json

Edit `public/config/toddler/default.json` to use CDN URLs:

### Before:
```json
{
  "id": "disneyPlusButton",
  "emoji": "🧚",
  "label": "Disney+",
  "thumbnail": "/public/06d8Po5VgMWjpiRU0RpZoul-18.webp",
  "appId": "291097"
}
```

### After:
```json
{
  "id": "disneyPlusButton",
  "emoji": "🧚",
  "label": "Disney+",
  "thumbnail": "https://roku-control-assets.b-cdn.net/thumbnails/disney-plus.webp",
  "appId": "291097"
}
```

### Full Example Updates:

```json
{
  "specialButtons": [
    {
      "id": "disneyPlusButton",
      "emoji": "🧚",
      "label": "Disney+",
      "thumbnail": "https://roku-control-assets.b-cdn.net/thumbnails/disney-plus.webp",
      "appId": "291097",
      "appName": "Disney+",
      "category": "kidMode-content",
      "zone": "quick"
    },
    {
      "id": "paramountPlusButton",
      "emoji": "🌟",
      "label": "Paramount+",
      "appId": "31440",
      "thumbnail": "https://roku-control-assets.b-cdn.net/thumbnails/paramount-plus.webp",
      "appName": "Paramount+",
      "category": "kidMode-content",
      "zone": "quick"
    },
    {
      "id": "fly",
      "emoji": "🗣️",
      "label": "Fly",
      "handler": "speakTts",
      "category": "kidMode-tts",
      "zone": "quick",
      "thumbnail": "https://roku-control-assets.b-cdn.net/buttons/fly.png",
      "args": ["Flying!!!!"]
    }
  ]
}
```

## Step 6: Clean Up Local Images (Optional)

Once CDN is working:

1. Delete images from `public/` directory
2. Keep only essential UI assets (if any)
3. Rebuild: `npm run build`
4. Check app size reduction

## Step 7: Remote Content URL (Optional)

For even easier updates, host your `default.json` on Bunny.net too:

1. Upload `default.json` to your storage zone root
2. Set remote URL in app settings:
   ```
   https://roku-control-assets.b-cdn.net/default.json
   ```
3. Now you can update content WITHOUT rebuilding the app!

**How it works:**
- App checks for remote URL in localStorage
- If set, fetches fresh JSON from CDN (no caching)
- If remote fails, falls back to bundled `default.json`

## Cost Estimate

Bunny.net pricing (as of 2024):
- **Storage**: $0.01/GB per month
- **Bandwidth**: $0.01-0.05/GB (varies by region)

**Example calculation for family app:**
- 10 images × 100KB each = 1MB storage = ~$0.01/month
- 100 loads/day × 1MB × 30 days = 3GB bandwidth = ~$0.03-0.15/month

**Total: ~$1-2/month for typical family usage**

## Testing Your CDN Setup

1. Upload one test image to Bunny.net
2. Get the CDN URL
3. Update one button in `default.json` to use CDN URL
4. Rebuild and test: `npm run build && npm run tauri:dev`
5. Verify image loads correctly
6. Check browser console for any CORS or loading errors

## Troubleshooting

### Images Not Loading

**Check CORS settings:**
1. Go to Pull Zone settings in Bunny.net
2. Find **CORS Settings**
3. Add wildcard: `*`
4. Save and purge cache

### Slow Loading

**Enable caching:**
1. Go to Pull Zone settings
2. **Cache Expiration**: Set to 1 day (86400 seconds)
3. Reduces load times for repeat visits

### Large Images

**Optimize before uploading:**
- Use WebP format (smaller than PNG/JPG)
- Resize to actual display size (e.g., 300×300px for thumbnails)
- Tools: ImageMagick, Squoosh.app, or Photoshop

## Alternative: Keep Local Images

If you prefer offline-first or want to avoid CDN costs:

**Hybrid approach:**
- Keep essential UI images bundled in `public/`
- Use CDN only for optional/updatable content
- Best of both worlds!

## Next Steps

1. Create Bunny.net account
2. Upload 1-2 test images with descriptive names
3. Update one button in `default.json` to test
4. Once working, migrate all images
5. Enjoy easy image updates without app rebuilds!

## Support

- Bunny.net docs: https://docs.bunny.net
- Storage Zone guide: https://docs.bunny.net/docs/storage-overview
- This app's documentation: See `CLAUDE.md`
