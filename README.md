# Toddler Phone Control

Toddler Phone Control is a family-friendly Roku remote that lets caregivers curate exactly what a preschooler can do on the TV, then locks the advanced settings behind a grown-up PIN. The app ships as a Tauri desktop bundle and an Android APK so the controls can run on a cheap phone, a wall-mounted tablet, or a living-room PC without involving cloud services.

## Why It Exists
- Kids want autonomy, but handing over the real Roku remote usually ends with unwanted purchases or late-night screen time. This project builds a safe "kid mode" surface with bright tiles, timers, and celebration screens so little ones stay on task while adults keep control.
- By running completely on the local network, it avoids privacy risks and works even when the internet cuts out. You can preload your own toddler buttons (cartoons, timers, "lights off" macros) and keep everything offline.

## What You Get
- A responsive remote with the full Roku External Control Protocol: navigation, app launch, playback, power, and volume.
- Curated kid buttons sourced from bundled config or optional remote URL; always fetches fresh content (no stale cache issues).
- Fixed bottom tabs: Remote (🎮), Roku Rooms (📺), Lights (💡), Magic Time (⏱️) - simple and always available.
- Macros for bedtime or "clean up" routines that string multiple Roku key presses, launch apps, and trigger celebratory fireworks.
- Native LAN bridges for Roku and Govee lights, bypassing browser CORS limitations so light toggles, brightness, and color scenes work reliably.
- A PIN-protected grown-up mode that unlocks connection settings, content sources, macros, and diagnostics for when you need to tweak the setup.

## Tech Stack
- **UI**: Hand-crafted HTML, vanilla JS, and Tailwind CSS compiled through `npm run build` into the `dist/` bundle.
- **Native Shell**: Tauri 2 with a Rust command layer (`roku_get`, `roku_post`, `govee_send`, `govee_discover`) so network calls run locally on macOS, Windows, and Android.
- **Automation**: Node-based scripts (`scripts/build.js`, `scripts/toddler-content-cli.js`) keep the build reproducible and provide a CLI for updating the kid button catalog.
- **Assets**: Canvas fireworks, haptics-ready button feedback, and optional confetti for positive reinforcement moments.

---

## Getting Started

### Prerequisites

**Required:**
- **Node.js 18+** - [Download here](https://nodejs.org/)
- **Rust** - [Install via rustup](https://rustup.rs/)
- **Tauri CLI** - Installed via npm (see below)

**Optional (for Android builds):**
- **Android Studio** with SDK/NDK
- **Java 17+**

### Installation

```bash
# Clone the repository
git clone https://github.com/kevmswartz/eli-capacitor.git
cd eli-capacitor

# Install dependencies
npm install
```

---

## Development Commands

### Building the Frontend

The app uses a custom Node build script that compiles Tailwind CSS and copies assets:

```bash
# Build once (required before Tauri commands)
npm run build

# Watch mode (auto-rebuilds on file changes)
npm run dev
```

**What it does:**
1. Cleans `dist/` directory
2. Compiles Tailwind CSS from `styles/tailwind.css`
3. Copies `index.html` and `app.js`
4. Copies vendor files (canvas-confetti)
5. Copies `public/` directory recursively (includes config files and images)

**Output:** All files go to `dist/` which Tauri uses as the frontend source.

### Running the App

```bash
# Development mode (auto-reloads Rust, manual reload for frontend)
npm run tauri:dev

# Or use the watch mode in another terminal:
# Terminal 1:
npm run dev

# Terminal 2:
npm run tauri:dev
```

**First Launch Setup:**
1. App opens with default bundled content
2. Click gear icon (top right) and hold for 2 seconds
3. Enter PIN: `1234`
4. Go to "Connection" section and enter your Roku's IP address
   - Find it: Roku Settings → Network → About
5. Save and start controlling your Roku!

### Building for Production

**Desktop (Windows/macOS/Linux):**
```bash
# Build release executable
npm run tauri:build

# Output locations:
# Windows: src-tauri/target/release/roku-control.exe
# macOS: src-tauri/target/release/bundle/macos/roku-control.app
# Linux: src-tauri/target/release/bundle/appimage/roku-control.AppImage
```

**Android:**
```bash
# First time setup (installs Android SDK/NDK)
# Windows:
./scripts/setup-android-env.ps1

# Build debug APK
npm run android:dev

# Build release APK (requires keystore)
npm run android:build

# Output: src-tauri/gen/android/app/build/outputs/apk/
```

**Signing Android APK (Production):**
```bash
# Windows only - signs and generates release artifacts
./scripts/build-release-artifacts.ps1
```

### Testing

```bash
# Run Rust tests
cd src-tauri
cargo test

# Run Rust linter
cargo clippy

# Type checking
cargo check
```

**Manual Testing Checklist:**
- [ ] All 4 tabs render (Remote, Roku Rooms, Lights, Magic Time)
- [ ] Kid buttons load and render correctly
- [ ] Roku controls work (test with real Roku device)
- [ ] PIN protection works (gear + hold + 1234)
- [ ] Settings save and persist
- [ ] Macros run correctly
- [ ] Timer/TTS/Fireworks work
- [ ] Govee lights toggle (if you have Govee H60A1 lights)

---

## Configuration

### Content Management

**File Structure:**
```
public/
  └── config/
      ├── button-types.json           # Handler documentation
      └── toddler/
          ├── default.json            # Bundled defaults (ships with app)
          └── custom.json             # Local override (gitignored, optional)
```

**Content Loading Priority:**
1. **Remote URL** (if configured in settings) - Always fetches fresh
2. **custom.json** (if exists) - Local override for testing
3. **default.json** (bundled) - Always available, ships with app

**For Development:**
```bash
# Interactive CLI to edit default.json
npm run content
```

**For Production:**
- Edit `public/config/toddler/default.json` manually
- Or use remote URL pointing to your hosted JSON file

### Remote Content URL (Optional)

Want to update content without rebuilding the app?

1. Upload your `default.json` to a CDN (see `BUNNY_CDN_SETUP.md`)
2. In app settings, set remote URL: `https://your-cdn.com/default.json`
3. App always fetches fresh content from URL
4. Falls back to bundled default if remote fails

**Benefits:**
- Update content anytime without rebuilding
- Still works offline (uses bundled fallback)
- Perfect for family with changing content needs

### Image Assets

**Current:** Images stored locally in `public/` directory

**Optional Migration to CDN:**
- See `BUNNY_CDN_SETUP.md` for complete guide
- Benefits: Smaller app size, easier image updates
- Cost: ~$1-2/month for family usage

---

## Architecture

### File Structure

```
eli-capacitor/
├── index.html                    # Main UI
├── app.js                        # Core frontend logic
├── styles/
│   └── tailwind.css              # Tailwind source
├── scripts/
│   ├── build.js                  # Custom build script
│   ├── toddler-content-cli.js    # Content management CLI
│   └── build-release-artifacts.ps1  # Release builder (Windows)
├── src-tauri/
│   ├── src/
│   │   ├── main.rs               # Entry point
│   │   ├── lib.rs                # Tauri app setup
│   │   ├── error.rs              # Error types
│   │   └── bridges/              # Native bridges
│   │       ├── roku.rs           # Roku HTTP bridge
│   │       ├── govee.rs          # Govee UDP bridge
│   │       └── roomsense.rs      # Future LAN discovery
│   ├── Cargo.toml                # Rust dependencies
│   └── tauri.conf.json           # Tauri configuration
├── public/
│   ├── config/
│   │   ├── button-types.json     # Handler docs
│   │   └── toddler/
│   │       └── default.json      # Kid buttons config
│   └── *.webp, *.png             # Image assets
├── dist/                         # Build output (gitignored)
├── CLAUDE.md                     # Developer instructions
├── REFACTOR_SUMMARY.md           # Recent changes log
├── BUNNY_CDN_SETUP.md           # CDN migration guide
└── README.md                     # This file
```

### Key Concepts

**Tauri Bridge Pattern:**
- Frontend calls Rust via `window.__TAURI__.invoke('command_name')`
- Rust bridges bypass browser CORS for LAN devices
- All network operations (Roku HTTP, Govee UDP) run natively

**Content Schema:**
```json
{
  "specialButtons": [
    {
      "id": "uniqueId",
      "emoji": "🎮",
      "label": "Button Text",
      "handler": "sendKey",           // Function name from handlers object
      "args": ["Home"],                // Arguments to pass
      "category": "kidMode-remote",
      "zone": "remote",                // "remote" or "quick"
      "thumbnail": "https://cdn.com/image.webp",  // Optional
      "appId": "291097"                // For app launches
    }
  ],
  "quickLaunch": [
    {
      "id": "videoId",
      "label": "Video Title",
      "type": "youtube",
      "videoId": "XqZsoesa55w",
      "thumbnail": "https://img.youtube.com/vi/XqZsoesa55w/maxresdefault.jpg"
    }
  ]
}
```

**Available Handlers:** See `public/config/button-types.json` for complete list
- `sendKey` - Send Roku remote key
- `launchApp` - Launch Roku channel
- `runMacro` - Execute saved macro
- `startToddlerTimer` - Start countdown timer
- `speakTts` - Text-to-speech (native)
- `startFireworksShow` - Celebration animation
- `goveeTogglePower` - Toggle Govee lights
- And more...

---

## Customization

### Changing the PIN

Edit `app.js` line 3:
```javascript
const PIN_CODE = '1234'; // Change to your desired PIN
```

Rebuild after changing.

### Adding New Buttons

**Option 1: Use CLI**
```bash
npm run content
# Follow prompts to add/edit buttons
```

**Option 2: Edit JSON Manually**

Edit `public/config/toddler/default.json`:
```json
{
  "specialButtons": [
    {
      "id": "netflixButton",
      "emoji": "🎬",
      "label": "Netflix",
      "appId": "12",
      "appName": "Netflix",
      "category": "kidMode-content",
      "zone": "quick",
      "thumbnail": "https://your-cdn.com/netflix-logo.webp"
    }
  ]
}
```

Rebuild and test: `npm run build && npm run tauri:dev`

### Adding New Roku Apps

**Find App ID:**
1. Launch app on Roku
2. In app settings, run "Roku Info" (gear button + hold + PIN)
3. Click "What's Playing?"
4. Copy the `appId` shown
5. Add to `default.json` with that `appId`

---

## Troubleshooting

### Build Issues

**Error: "Cannot find module 'tailwindcss/lib/cli.js'"**
```bash
npm install
```

**Error: "button-types.json not found"**
- Check `public/config/button-types.json` exists
- Run `npm run build` to copy files to `dist/`

### Runtime Issues

**"Command not found" errors in console**
- Ensure Tauri commands are registered in `src-tauri/src/lib.rs`
- Check command name matches exactly

**CORS errors when controlling Roku**
- You're running in browser instead of Tauri
- Use `npm run tauri:dev` instead of opening `index.html` directly
- Tauri's Rust bridge bypasses CORS

**Content not loading**
- Check browser console for fetch errors
- Verify paths in `default.json` are correct
- For remote URLs, ensure CORS is enabled on server

**Images not showing**
- Check image paths in `default.json`
- For local images: Use `/public/filename.webp`
- For CDN images: Use full URL `https://cdn.com/filename.webp`

### Android Issues

**Build fails with "SDK not found"**
```bash
# Set environment variables (Windows)
setx ANDROID_HOME "C:\Users\YourName\AppData\Local\Android\Sdk"
setx JAVA_HOME "C:\Program Files\Java\jdk-17"

# Or run setup script
./scripts/setup-android-env.ps1
```

**App crashes on Android device**
- Check `adb logcat` for errors
- Verify all Tauri commands are registered
- Test in dev mode first: `npm run android:dev`

---

## Security & Privacy

**Local Network Only:**
- All Roku/Govee communication is LAN-only
- No internet required for core functionality
- No telemetry or tracking

**PIN Protection:**
- Default PIN: `1234` (change in code)
- Protects all advanced settings
- Kid mode is safe and locked down

**Offline-First:**
- Works without internet
- Bundled defaults always available
- Remote URLs are optional enhancement

---

## Contributing

This is primarily a family project, but suggestions are welcome!

**Before submitting PRs:**
1. Read `CLAUDE.md` for developer guidelines
2. Test on both desktop and Android (if possible)
3. Ensure build completes: `npm run build && npm run tauri:build`
4. Keep the simple, single-family-app philosophy

---

## Release Process

**Desktop Release:**
```bash
# Build for your platform
npm run build
npm run tauri:build

# Find executable in:
# src-tauri/target/release/
```

**Android Release:**
```bash
# Windows (signs and packages)
./scripts/build-release-artifacts.ps1

# Output: app-release-signed.apk in repo root
```

**Artifacts in Repo:**
- `roku-control.exe` - Windows desktop release
- `app-release-signed.apk` - Signed Android APK

These are kept in the repo for easy family distribution.

---

## Additional Documentation

- **CLAUDE.md** - Detailed architecture and developer guide
- **REFACTOR_SUMMARY.md** - Recent simplification changes (~700 lines removed!)
- **BUNNY_CDN_SETUP.md** - Guide for migrating images to CDN

---

## Where to Learn More

- Screens, UX notes, and additional context live on the companion site: [kevmswartz/toddler-phone-control](https://github.com/kevmswartz/toddler-phone-control/)
- Release artifacts from this repo let you sideload an inexpensive Android phone so "the toddler remote" is a sealed device with only approved experiences

---

## Quick Reference

```bash
# Development
npm install              # Install dependencies
npm run build           # Build frontend
npm run dev             # Build frontend (watch mode)
npm run tauri:dev       # Launch app in dev mode

# Production
npm run tauri:build     # Build desktop executable
npm run android:build   # Build Android APK

# Content Management
npm run content         # CLI to edit default.json

# Testing
cd src-tauri && cargo test    # Run Rust tests
cd src-tauri && cargo clippy  # Run linter
```

---

Built so your kid can tap the Baby Shark button without accidentally opening HBO. Enjoy the calm. 🎵
