# ⚠️ IMPORTANT: What Gets Deployed to Netlify

## This Directory Only!

When you deploy to Netlify, **ONLY** the contents of `netlify/public/` and `netlify/functions/` are deployed.

**The main app (root `index.html`, `app.js`) is NOT deployed to Netlify.**

## What's Deployed

```
netlify/
├── public/                    ← Static site (homepage)
│   ├── index.html            ← Simple landing page
│   └── test-auth.html        ← Passphrase tester
└── functions/                 ← API endpoints
    ├── config.js             ← Main config API
    ├── config-list.js        ← List configs
    ├── config-import.js      ← Import config
    └── auth-helper.js        ← Authentication
```

## What's NOT Deployed

```
/index.html                    ← Main app (NOT deployed)
/app.js                        ← Main app (NOT deployed)
/dist/                         ← Build output (NOT deployed)
/public/                       ← App assets (NOT deployed)
```

## Why?

The `netlify.toml` file specifies:
```toml
[build]
  publish = "netlify/public"    # ← Only this directory
  functions = "netlify/functions"
```

## What You'll See

**On Netlify (toddler-phone-control.netlify.app):**
- Simple landing page with GitHub link
- Test passphrase page
- API endpoints at `/api/*`

**NOT the full app!** The full app runs as a Tauri desktop/Android app locally.

## Common Confusion

❌ **Wrong:** Deploying the root directory shows the app but breaks styling
✅ **Right:** Deploying via GitHub with `netlify.toml` shows the simple landing page

## How to Deploy Correctly

1. Connect Netlify to your GitHub repo
2. Netlify reads `netlify.toml` automatically
3. Only `netlify/public/` and `netlify/functions/` are deployed
4. Done!

**Result:** Simple landing page at root, API at `/api/*`, no confusion!
