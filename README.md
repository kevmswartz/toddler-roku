# Toddler Phone Control

> A family-friendly Roku remote control with curated kid-mode, built on Tauri 2 for desktop and Android.

Toddler Phone Control lets caregivers create a safe TV experience for preschoolers. Kids get bright, simple buttons for approved content, while advanced settings stay locked behind a PIN. Run it on an old phone, tablet, or PC—no cloud required.

[![Built with Tauri](https://img.shields.io/badge/Tauri-2.0-blue)](https://tauri.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## ✨ Features

### For Kids
- **Bright, Simple Interface** - Large emoji buttons designed for toddlers
- **Curated Content** - Only shows approved apps and channels
- **Magic Time** - Built-in timer with celebration animations
- **Text-to-Speech** - Fun voice messages and encouragement
- **Celebration Animations** - Fireworks and confetti for positive reinforcement

### For Parents
- **PIN-Protected Settings** - Advanced controls locked behind PIN (default: `1234`)
- **Macro System** - Create bedtime routines that chain actions together
- **Local Network Only** - No internet required, no privacy concerns
- **Multi-Platform** - Desktop (Windows/macOS/Linux) and Android
- **Smart Home Integration** - Control Govee lights alongside TV
- **Remote Updates** - Optional cloud config for updates without rebuilding

### Technical Features
- **Full Roku Control** - Complete Roku External Control Protocol (ECP) support
- **Native Bridges** - Bypass browser CORS with Rust backend
- **Offline First** - Works without internet, bundled defaults always available
- **Zero Telemetry** - Completely private, no tracking or analytics

---

## 🚀 Quick Start

### Prerequisites

**Required:**
- [Node.js 18+](https://nodejs.org/)
- [Rust](https://rustup.rs/) (via rustup)
- npm (included with Node.js)

**For Android builds:**
- [Android Studio](https://developer.android.com/studio) with SDK/NDK
- Java 17+

### Installation

```bash
# Clone the repository
git clone https://github.com/kevmswartz/toddler-phone-control.git
cd toddler-phone-control

# Install dependencies
npm install

# Build the frontend
npm run build

# Run in development mode
npm run tauri:dev
```

### First Launch Setup

1. App opens with bundled default content
2. Click the ⚙️ gear icon (top right) and **hold for 2 seconds**
3. Enter PIN: `1234`
4. Navigate to "Connection" section
5. Enter your Roku's IP address
   - Find it: Roku Settings → Network → About
6. Click "Save" and start controlling your Roku!

---

## 📱 Platforms

### Desktop
Build native executables for Windows, macOS, and Linux:

```bash
npm run tauri:build
```

**Output locations:**
- Windows: `src-tauri/target/release/roku-control.exe`
- macOS: `src-tauri/target/release/bundle/macos/roku-control.app`
- Linux: `src-tauri/target/release/bundle/appimage/roku-control.AppImage`

### Android

#### First-time Android Setup (Windows)
```bash
./scripts/setup-android-env.ps1
```

#### Build APK
```bash
# Development (unsigned)
npm run android:build

# Production (signed - requires keystore)
./scripts/build-release-artifacts.ps1
```

**Output:** `src-tauri/gen/android/app/build/outputs/apk/`

---

## 🏗️ Architecture

### Hybrid Tauri Application

```
┌─────────────────────────────────────┐
│   Frontend (WebView)                │
│   • Vanilla JavaScript (app.js)    │
│   • HTML + Tailwind CSS             │
│   • Canvas Confetti animations      │
└──────────────┬──────────────────────┘
               │ Tauri Bridge
               │ window.__TAURI__.invoke()
┌──────────────▼──────────────────────┐
│   Backend (Rust)                    │
│   • Roku HTTP Bridge (reqwest)     │
│   • Govee UDP Bridge (LAN)         │
│   • Roomsense BLE Bridge            │
└─────────────────────────────────────┘
```

### Project Structure

```
toddler-phone-control/
├── app.js                         # Frontend logic (206KB)
├── index.html                     # Main UI
├── styles/
│   └── tailwind.css              # Tailwind source
├── public/
│   ├── config/
│   │   ├── button-types.json     # Handler documentation
│   │   └── toddler/
│   │       ├── default.json      # Bundled kid buttons
│   │       └── custom.json       # Local override (gitignored)
│   └── *.webp, *.png             # Image assets
├── src-tauri/
│   ├── src/
│   │   ├── main.rs               # Entry point
│   │   ├── lib.rs                # Tauri setup & command registration
│   │   ├── error.rs              # Error handling
│   │   └── bridges/              # Native protocol bridges
│   │       ├── roku.rs           # Roku ECP (HTTP)
│   │       ├── govee.rs          # Govee lights (UDP)
│   │       └── roomsense.rs      # BLE device discovery
│   ├── Cargo.toml                # Rust dependencies
│   └── tauri.conf.json           # Tauri configuration
├── scripts/
│   ├── build.js                  # Custom frontend build
│   ├── toddler-content-cli.js    # Content management CLI
│   └── build-release-artifacts.ps1 # Production build
├── netlify/                       # Optional cloud config hosting
│   ├── functions/                # Serverless API
│   └── public/                   # Landing page
├── dist/                         # Build output (gitignored)
├── CLAUDE.md                     # Developer/contributor guide
└── README.md                     # This file
```

---

## 🎮 Usage

### Four Fixed Tabs

The app has four always-visible tabs:

1. **🎮 Remote** - Standard Roku controls (navigation, back, home, etc.)
2. **📺 Roku Rooms** - App launcher + Quick Launch content grid
3. **💡 Lights** - Govee smart light controls (on/off, brightness, color)
4. **⏱️ Magic Time** - Timer, text-to-speech, celebration animations

All advanced settings are behind the ⚙️ gear button + 2-second hold + PIN.

### Content System

**Content Loading Priority:**
1. **Remote URL** (if configured) - Always fetches fresh, no caching
2. **Local Custom** (`public/config/toddler/custom.json`) - For local testing
3. **Bundled Default** (`public/config/toddler/default.json`) - Ships with app

**Benefits:**
- Always fresh content from remote URLs
- Works offline with bundled defaults
- Easy local development (no cache issues)

### Managing Content

#### Option 1: Netlify Admin UI (Recommended)
Use the web-based admin interface to manage all content:
- Add/edit buttons with visual forms
- Upload images directly
- Configure settings remotely
- See changes instantly in the app

See `netlify/README.md` for setup and usage.

#### Option 2: Manual Editing

Edit `public/config/toddler/default.json` locally:

```json
{
  "specialButtons": [
    {
      "id": "disneyButton",
      "emoji": "🧚",
      "label": "Disney+",
      "appId": "291097",
      "appName": "Disney+",
      "category": "kidMode-content",
      "zone": "quick",
      "thumbnail": "https://cdn.example.com/disney.webp"
    }
  ],
  "quickLaunch": [
    {
      "id": "babyShark",
      "label": "Baby Shark",
      "type": "youtube",
      "videoId": "XqZsoesa55w",
      "thumbnail": "https://img.youtube.com/vi/XqZsoesa55w/maxresdefault.jpg"
    }
  ]
}
```

**Available Handlers:** See `public/config/button-types.json` for full list
- `sendKey` - Roku remote key press
- `launchApp` - Launch Roku channel
- `runMacro` - Execute saved macro
- `startToddlerTimer` - Countdown timer
- `speakTts` - Text-to-speech
- `startFireworksShow` - Celebration animation
- `goveeTogglePower` - Toggle Govee lights
- And more...

### Macros

Create multi-step routines in Advanced Settings:

**Example "Bedtime Routine" macro:**
1. Press Home key
2. Wait 1 second
3. Launch Disney+
4. Turn off Govee lights
5. Play celebration animation

Macros are stored in `localStorage` as JSON and can include:
- Roku key presses
- App launches
- Delays/waits
- Light controls
- TTS messages

---

## ⚙️ Configuration

### Changing the PIN

Edit `app.js` line 3:
```javascript
const PIN_CODE = '1234'; // Change to your desired PIN
```

Rebuild after changing: `npm run build`

### Remote Content Management via Netlify

Update content, images, and settings without rebuilding the app:

**Setup:**
1. Deploy this repo to Netlify (already configured via `netlify.toml`)
2. Set your 5-word passphrase as environment variable `CONFIG_PASSPHRASE`
3. Upload your config via the Netlify admin UI or API
4. In app settings, set remote URL: `https://toddler-phone-control.netlify.app/api/config`

**Features:**
- 🎨 Upload images directly to Netlify Blobs
- 📝 Edit buttons and content via web UI
- 🔢 Set PIN remotely
- 📺 Configure Roku/Govee settings
- 💾 Changes sync automatically to all devices

**Benefits:**
- Update content anytime without rebuilding app
- Manage images in the cloud (smaller app size)
- Works offline with bundled fallback
- Perfect for families with changing needs
- Free on Netlify's generous free tier

See `netlify/README.md` for complete setup guide.

### Govee Lights Setup

1. In app settings, enter your Govee device's local IP
2. Ensure Govee light is on the same LAN
3. Uses UDP port 4003 (Govee LAN API)
4. Supports: H60A1 and compatible models

---

## 🛠️ Development

### Build Commands

```bash
# Frontend build
npm run build              # Build once
npm run dev                # Watch mode (auto-rebuild)

# Desktop development
npm run tauri:dev          # Launch Tauri in dev mode

# Production builds
npm run tauri:build        # Desktop executable
npm run android:build      # Android APK
```

### Custom Build Process

The build script (`scripts/build.js`) does:
1. Cleans `dist/` directory
2. Compiles Tailwind CSS from `styles/tailwind.css`
3. Copies `index.html` and `app.js`
4. Copies vendor files (canvas-confetti)
5. Copies `public/` directory recursively

**Important:** Always run `npm run build` before Tauri commands, as Tauri's `frontendDist` points to `../dist`.

### Adding New Tauri Commands

1. Create/edit bridge in `src-tauri/src/bridges/`
2. Add `#[tauri::command]` attribute
3. Use `tauri::State` for shared state if needed
4. Register in `src-tauri/src/lib.rs` → `invoke_handler!` macro
5. Return `Result<T, String>` (errors auto-convert to JS)

**Example:**
```rust
#[tauri::command]
async fn roku_get(url: String) -> Result<String, String> {
    // Implementation
    Ok(response_body)
}
```

Register:
```rust
.invoke_handler(tauri::generate_handler![
    roku_get,
    roku_post,
    // ... other commands
])
```

### Testing

```bash
# Rust tests
cd src-tauri
cargo test

# Rust linting
cargo clippy

# Type checking
cargo check
```

**Manual Testing Checklist:**
- [ ] All 4 tabs render correctly
- [ ] Kid buttons load from config
- [ ] Roku controls work (requires real Roku)
- [ ] PIN protection works (gear + hold + `1234`)
- [ ] Settings persist after restart
- [ ] Macros execute correctly
- [ ] Timer/TTS/Fireworks work
- [ ] Govee lights toggle (if available)

---

## 🌐 Network Protocols

### Roku External Control Protocol (ECP)

The app communicates with Roku via HTTP on port 8060:

```
Base URL: http://{ROKU_IP}:8060

POST /keypress/{Key}              # Press remote key (e.g., Home, Up, Select)
POST /launch/{appId}              # Launch channel/app
POST /launch/{appId}?contentID={id}  # Deep link to content
GET  /query/device-info           # Device information (XML)
GET  /query/active-app            # Currently running app (XML)
```

### Govee LAN Protocol

Govee lights use UDP JSON commands on port 4003:

```json
{
  "msg": {
    "cmd": "turn",
    "data": {
      "value": 1  // 0=off, 1=on
    }
  }
}
```

Other commands:
- `brightness` - Set brightness (1-100)
- `colorwc` - Set RGB color + brightness

---

## 🔒 Security & Privacy

### Local Network Only
- All Roku/Govee communication is LAN-only
- No internet required for core functionality
- No cloud dependencies

### No Telemetry
- Completely offline application
- No analytics or tracking
- No data collection

### PIN Protection
- Default PIN: `1234` (changeable in code)
- Protects all advanced settings
- Kid mode is locked down and safe

### Offline-First
- Works without internet connection
- Bundled defaults always available
- Remote URLs are optional enhancement

**Security Note:** The PIN is currently hardcoded in `app.js`. For production use, consider implementing a hashed PIN stored in settings.

---

## 📚 Additional Documentation

- **`CLAUDE.md`** - Comprehensive developer guide with architecture details
- **`CODEBASE_AUDIT.md`** - Health analysis and refactoring roadmap
- **`netlify/README.md`** - Netlify deployment, admin UI, and API docs
- **`public/config/button-types.json`** - Handler function reference

---

## 🐛 Troubleshooting

### Build Issues

**"Cannot find module 'tailwindcss/lib/cli.js'"**
```bash
npm install
```

**"button-types.json not found"**
```bash
npm run build  # Copies config files to dist/
```

### Runtime Issues

**"Command not found" in console**
- Ensure command is registered in `src-tauri/src/lib.rs`
- Check command name matches exactly in `invoke()` call

**CORS errors when controlling Roku**
- Running in browser instead of Tauri
- Use `npm run tauri:dev` instead of opening `index.html` directly
- Tauri's Rust bridge bypasses CORS

**Content not loading**
- Check browser console for fetch errors
- Verify paths in `default.json` are correct
- For remote URLs, ensure server has CORS enabled

**Images not showing**
- Local images: Use `/public/filename.webp`
- CDN images: Use full URL `https://cdn.com/filename.webp`
- Check browser console for 404 errors

### Android Issues

**"SDK not found"**
```bash
# Windows
./scripts/setup-android-env.ps1

# Manual setup
setx ANDROID_HOME "C:\Users\YourName\AppData\Local\Android\Sdk"
setx JAVA_HOME "C:\Program Files\Java\jdk-17"
```

**App crashes on Android**
- Check `adb logcat` for errors
- Verify all Tauri commands are registered
- Test in dev mode first: `npm run tauri:dev` on desktop

### Network Issues

**Can't connect to Roku**
- Verify Roku IP address (Settings → Network → About)
- Ensure device is on same network
- Test with browser: `http://{ROKU_IP}:8060/query/device-info`

**Govee lights not responding**
- Check Govee device local IP
- Ensure on same LAN
- Verify device supports LAN control (H60A1 and compatible)

---

## 🤝 Contributing

This is primarily a family project, but suggestions are welcome!

**Before submitting PRs:**
1. Read `CLAUDE.md` for developer guidelines
2. Test on both desktop and Android (if possible)
3. Ensure build completes: `npm run build && npm run tauri:build`
4. Keep the simple, single-family-app philosophy
5. No telemetry or cloud dependencies

---

## 📄 License

[MIT License](LICENSE)

---

## 🙏 Acknowledgments

**Built with:**
- [Tauri](https://tauri.app/) - Rust-powered desktop/mobile apps
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS
- [canvas-confetti](https://github.com/catdad/canvas-confetti) - Celebration animations
- Roku External Control Protocol
- Govee LAN API

---

## 📞 Support

- **Issues:** [GitHub Issues](https://github.com/kevmswartz/toddler-phone-control/issues)
- **Discussions:** [GitHub Discussions](https://github.com/kevmswartz/toddler-phone-control/discussions)

---

**Built with ❤️ for families who want safe, simple TV control for toddlers.**

*So your kid can tap the Baby Shark button without accidentally ordering HBO. Enjoy the calm.* 🎵
