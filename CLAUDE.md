# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Toddler Phone Control is a family-friendly Roku remote built with Tauri 2. It provides a curated kid-mode interface for toddlers/preschoolers while keeping advanced settings behind a PIN (default: `1234`). The app ships as desktop executables (Windows, macOS) and Android APK, designed to run on cheap phones, tablets, or PCs without cloud dependencies.

**Content Management:** Uses Netlify for remote configuration, image hosting, and settings sync. See `netlify/README.md` for admin UI and API documentation.

**Codebase Health:** The main `app.js` file is currently 5,751 lines. See `CODEBASE_AUDIT.md` for analysis and refactoring roadmap. New features should be added carefully, and the Netlify admin UI is being built as a separate, clean codebase.

## Architecture

### Hybrid Frontend/Backend Structure

This is a **Tauri 2 hybrid app** with clear separation between web UI and native backend:

**Frontend (web layer)**:
- Vanilla JavaScript in `app.js` (no framework)
- Hand-crafted HTML in `index.html`
- Tailwind CSS for styling (`styles/tailwind.css`)
- Runs in WebView on all platforms

**Backend (Rust layer)** in `src-tauri/`:
- Tauri commands expose native capabilities via `tauri::command` macros
- Bridge modules in `src-tauri/src/bridges/` handle network protocols that browsers can't (UDP for Govee, HTTP without CORS for Roku)
- Commands: `roku_get`, `roku_post`, `govee_send`, `govee_discover`, `roomsense_scan`

### Key Bridge Pattern

The frontend calls native Rust through `window.__TAURI__.invoke()` or `window.__TAURI__.core.invoke()`. The app detects the runtime environment with `isNativeRuntime` constant in `app.js`:

```javascript
const tauriInvoke = (() => {
    if (!tauriBridge) return undefined;
    if (typeof tauriBridge.invoke === 'function') {
        return tauriBridge.invoke.bind(tauriBridge);
    }
    // fallback checks for .core.invoke or .tauri.invoke
})();
```

When running in native mode, network calls bypass browser CORS restrictions through Rust bridges:
- **Roku HTTP**: `bridges/roku.rs` uses `reqwest::blocking::Client` with 6s timeout
- **Govee UDP**: `bridges/govee.rs` sends JSON commands to LAN devices on port 4003
- **Roomsense**: `bridges/roomsense.rs` (future LAN device discovery)

### Content Management System

Curated kid buttons come from `public/config/toddler/default.json` (bundled default) or a remote URL stored in localStorage. The content schema defines:
- `specialButtons[]`: Each button has an `id`, `emoji`, `label`, `handler`, and `category`
- Categories: `kidMode-remote`, `kidMode-content`, `kidMode-system`
- Zones: `remote` (always visible), `quick` (toddler-focused content)

The `public/config/button-types.json` file documents all handler functions and their purpose (e.g., `sendKey`, `launchApp`, `runMacro`).

**Content Loading (Simplified)**:
1. If remote URL configured → fetch fresh from URL (no caching!)
2. If remote fails or no URL → load from `custom.json` (if exists)
3. Otherwise → load from bundled `default.json` (always available)
4. Shows error only if all sources fail

**Benefits:**
- Always fresh content from remote URLs
- No stale cache issues
- Easy local testing (clear remote URL)
- Works offline with bundled defaults

### State Management

All state lives in localStorage with typed keys:
- `roku_ip`: Roku device IP address
- `roku_macros`: JSON array of saved macro sequences
- `toddler_content_url`: Optional remote content source URL (always fetches fresh)
- `govee_ip`, `govee_port`, `govee_brightness`: Govee light settings
- `govee_power_state_{ip}`: Per-device power state tracking

## Common Development Commands

### Build System

The build process is **Node-based** (not Tauri's default):

```bash
# Build frontend assets (required before running Tauri)
npm run build

# Watch mode for development (rebuilds on file changes)
npm run dev

# Desktop development (auto-rebuilds frontend, launches Tauri)
npm run tauri:dev

# Production desktop build
npm run tauri:build

# Android build (requires Android SDK setup)
npm run android:build
```

The custom build script (`scripts/build.js`):
1. Cleans `dist/` directory
2. Compiles Tailwind CSS from `styles/tailwind.css`
3. Copies static files: `index.html`, `app.js`
4. Copies vendor files (e.g., canvas-confetti)
5. Copies `public/` directory recursively (includes config files, thumbnails, and all assets)

**Important**: The Tauri config points `frontendDist` to `../dist`, so `npm run build` must run before Tauri commands.

### Content Management

Content is managed through Netlify:

**For production updates:**
- Use Netlify admin UI (web interface)
- Upload images to Netlify Blobs
- Edit config via API or admin UI
- Changes sync automatically to all devices
- See `netlify/README.md` for details

**For local development:**
- Edit `public/config/toddler/default.json` directly
- Rebuild with `npm run build`
- Test locally before deploying

### Tauri Commands

```bash
# Standard Tauri CLI (use through npm scripts)
npx tauri dev
npx tauri build
npx tauri android dev
npx tauri android build
```

## Rust Backend Details

### Module Structure

- `src-tauri/src/main.rs`: Entry point, calls `roku_control_app::run()`
- `src-tauri/src/lib.rs`: Tauri app setup, command registration, state management
- `src-tauri/src/error.rs`: Centralized error types (`BridgeError`)
- `src-tauri/src/bridges/mod.rs`: Module exports for `roku`, `govee`, `roomsense`

### Adding New Tauri Commands

1. Define command in appropriate bridge module (or create new bridge)
2. Add `#[tauri::command]` attribute
3. Use `tauri::State` for shared state (HTTP clients, etc.)
4. Register in `lib.rs` via `invoke_handler`
5. Return `Result<T, String>` (errors auto-convert to JS)

Example from `lib.rs`:
```rust
#[tauri::command]
async fn roku_post(
    state: tauri::State<'_, RokuHttpClient>,
    url: String,
    body: Option<String>,
) -> Result<(), String> {
    state.post(&url, body.as_deref()).await.map_err(|err| err.to_string())
}
```

### Testing Rust Changes

```bash
cd src-tauri
cargo check       # Fast syntax check
cargo build       # Debug build
cargo clippy      # Linting
```

Tauri automatically rebuilds Rust when you run `npm run tauri:dev` if source files changed.

## Frontend Architecture

### Single-File Application

The entire frontend logic lives in `app.js` (~1000+ lines). Key patterns:

**Handler Registration**:
All button handlers are registered in a `handlers` object at the bottom of `app.js`. To add a new button type:
1. Add handler function to the `handlers` object
2. Update `public/config/button-types.json` to document the handler
3. Add buttons to `public/config/toddler/default.json` with the handler name

**Macro System**:
Macros are stored as JSON arrays in localStorage (`roku_macros`). Each macro has:
- `name`: Display name
- `emoji`: Visual indicator
- `steps[]`: Array of `{ type, params }` objects
  - Types: `key`, `wait`, `app`, `lights`, `tts`

**Tab System (Simplified)**:
The app has 4 fixed tabs (always visible, no customization):
- `remote`: Remote controls (🎮) - Always pinned
- `apps`: Roku Rooms (📺) - Apps grid + Quick Launch
- `lights`: Lights (💡) - Govee light controls
- `magic`: Magic Time (⏱️) - Timer, TTS, Fireworks

All advanced settings are behind the gear button + PIN protection.

## Platform-Specific Notes

### Android

The Android project lives in `src-tauri/gen/android/`. Key files:
- `app/src/main/AndroidManifest.xml`: Permissions, activity config
- `app/build.gradle.kts`: Build configuration
- `buildSrc/src/main/java/com/eli/rokucontrol/kotlin/RustPlugin.kt`: Custom Rust build integration

**Signing**: Production APKs are signed with `roku-control.keystore` (not in repo). The build script `scripts/build-release-artifacts.ps1` handles signing.

### Windows

Windows builds produce `roku-control.exe`. The executable is configured to hide the console window in release mode (`windows_subsystem = "windows"` in `main.rs`).

## Important Configuration Files

- `tauri.conf.json`: Tauri app config (product name, identifier, window size, build commands)
- `Cargo.toml`: Rust dependencies (reqwest for HTTP, serde for JSON)
- `rust-toolchain.toml`: Pins Rust version for consistency
- `tailwind.config.cjs`: Tailwind setup, content paths, custom colors

## Network Protocols

### Roku External Control Protocol (ECP)

The app communicates with Roku via HTTP:
- Base URL: `http://{ROKU_IP}:8060`
- Key press: `POST /keypress/{Key}` (e.g., `/keypress/Home`)
- Launch app: `POST /launch/{appId}` (e.g., `/launch/291097` for Disney+)
- Deep link: `POST /launch/{appId}?contentID={id}`
- Device info: `GET /query/device-info` (returns XML)
- Active app: `GET /query/active-app` (returns XML)

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

Other commands: `brightness` (1-100), `colorwc` (RGB + brightness).

## Release Artifacts

Pre-built binaries live in repo root:
- `roku-control.exe`: Windows desktop
- `app-release-signed.apk`: Signed Android APK

These are generated by `scripts/build-release-artifacts.ps1` (PowerShell, Windows-only).

## Security Model

- **PIN Protection**: The default PIN `1234` is hardcoded in `app.js` (`PIN_CODE` constant). Change this before distribution.
- **Local Network Only**: All Roku/Govee communication is LAN-only (no internet required).
- **No Telemetry**: The app is fully offline, no analytics or tracking.

## Troubleshooting

**Issue**: Tauri commands return "command not found"
- Ensure the command is registered in `lib.rs` `invoke_handler` macro
- Check frontend is using correct command name in `invoke()`

**Issue**: Android build fails
- Run `scripts/setup-android-env.ps1` to install Android SDK/NDK
- Verify `ANDROID_HOME` and `JAVA_HOME` environment variables

**Issue**: Tailwind styles not applying
- Run `npm run build` to recompile CSS
- Check `tailwind.config.cjs` content paths match source files

**Issue**: Roku commands fail with CORS error
- This means the app is running in a browser, not Tauri (wrong launch command)
- Use `npm run tauri:dev` instead of opening `index.html` directly
