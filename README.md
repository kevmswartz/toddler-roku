# Roku Control App

A web-based remote control for your Roku device with app launching capabilities.

## Features

- Save Roku IP address in browser localStorage
- Check device status and connection
- View all installed apps
- Launch any app with one click
- Full remote control (navigation, playback, volume, etc.)

## Setup

### Prerequisites
- [Node.js](https://nodejs.org/) 18 or newer
- npm

```bash
npm install
```

### Build Web Assets

The UI ships from the `dist/` folder. Rebuild whenever you change HTML/JS/CSS or toddler content:

```bash
npm run build      # compile into dist/
```

During development `npm run dev` keeps the build script running in watch mode.

## Running the App

### Desktop (Tauri)

```bash
npm run tauri:dev      # build web assets (watch) and launch the desktop shell
```

Packaging a distributable build:

```bash
npm run tauri:build
```

This produces platform installers/bundles under `src-tauri/target/`.

### Browser Preview (CORS limited)

You can still open `index.html` directly or serve `dist/` with any static server, but Roku devices will reject the requests because of CORS unless you run within the same network and disable CORS in the browser. Native builds via Tauri are the recommended path.

### Release Bundles (Windows + Android)

Use the helper script to produce both a Windows executable and a signed Android APK in the project root:

```powershell
.\scripts\build-release-artifacts.ps1 `
  -KeystorePath 'C:\path\to\roku-control.keystore' `
  -KeyAlias 'rokuControl' `
  -AndroidTargets 'aarch64'
```

The script runs the Tauri desktop build, copies the generated `roku-control.exe`, builds the Android target(s), and signs the latest unsigned APK as `app-release-signed.apk`. Supply additional comma-separated targets (e.g. `aarch64,armv7`) if you need more than one ABI.

## Why Tauri?

The Roku External Control Protocol does not send CORS headers, so browser-based fetches are blocked. The Tauri shell provides native bridges (`roku_get`, `roku_post`, `govee_send`, `govee_discover`, `roomsense_scan`) so the web UI can talk to the local network without needing a proxy or cloud service. On platforms where the Tauri runtime is available, these commands are invoked directly from the existing JavaScript SDK, keeping the browser fallback for basic previews. The `roomsense_scan` command is currently a stub that returns an unsupported error until the BLE + Wi-Fi bridge is implemented.

## Kid Button Content

- Generate or edit `toddler-content.json` with the CLI:
  ```bash
  npm run content -- list
  npm run content -- add-quick --id babyShark --label "Baby Shark" --type youtube --videoId OBqZDyVlFP8
  npm run content -- add-special --id bedtime --label "Bedtime" --emoji "🌙" --handler runFavoriteMacro --zone quick
  ```
  Use `npm run content -- --help` to see all commands (init, add-special, add-quick, remove, list).
- Commit the JSON to your git repo (for example on GitHub) and copy the raw file URL. Many teams keep a `content` branch just for the JSON so anyone can PR new buttons without touching the app code.
- In the app’s Settings (after unlocking), paste the raw URL into **Kid Button Source** and click **Save URL & Refresh**. The desktop and Android builds cache the remote JSON for offline use; you can refresh or clear the cache anytime.
- Prefer a script? Run `./scripts/update-toddler-content.ps1 -Url "https://raw.githubusercontent.com/<org>/<repo>/<branch>/toddler-content.json"` to download the latest remote JSON into the repo (a timestamped backup is created automatically).
- Want a guided workflow? `./scripts/manage-toddler-content.ps1 -Action menu` adds Roku app launchers, YouTube quick launches, TTS buttons, countdown timers, or fireworks celebrations through simple prompts (use `-Action add-quick-app`, `add-quick`, `add-tts`, `add-timer`, `add-fireworks`, etc. for direct commands).
- To create a countdown button, run `./scripts/manage-toddler-content.ps1 -Action add-timer` and follow the prompts; the new button will use the `startToddlerTimer` handler and works out of the box with the built-in overlay.
- To celebrate wins, use `./scripts/manage-toddler-content.ps1 -Action add-fireworks` to wire up a button that calls `startFireworksShow` with custom duration and narration.
- For Govee LAN buttons, you can pass overrides directly in the handler args, e.g. `{ "handler": "goveePower", "args": [true, "192.168.1.52", 4003] }` or `{ "handler": "goveeSetColor", "args": [255, 120, 60, { "ip": "192.168.1.60" }] }`. The app falls back to the saved IP/port when no override is provided.
- Sample buttons for a strip at `192.168.40.8`:
  ```json
  { "id": "lightsOn", "label": "Lights On", "emoji": "💡", "handler": "goveePower", "args": [true, "192.168.40.8", 4003], "zone": "quick", "category": "kidMode-lights" }
  { "id": "lightsOff", "label": "Lights Off", "emoji": "🌙", "handler": "goveePower", "args": [false, "192.168.40.8", 4003], "zone": "quick", "category": "kidMode-lights" }
  { "id": "lightsToggle", "label": "Toggle Lights", "emoji": "🔁", "handler": "goveeTogglePower", "args": ["192.168.40.8", 4003], "zone": "quick", "category": "kidMode-lights" }
  ```
  The toggle tracks the last known state locally; if the strip is controlled elsewhere, tap the explicit On/Off buttons once to resync.

### Unlocking Advanced Settings

- Long-press the gear button in the top-left corner for about two seconds to open the PIN pad (default `1234`).
- After entering the PIN, the advanced sections (connection settings, kid button source, macros, etc.) become visible.
- When you are finished, use the **Hide Advanced Controls** button at the top of the advanced area to tuck everything away again for kid mode.
- The **Govee Lights** panel lets you enter the H60A1’s LAN IP (from the Govee Home app), set the port (default `4003`), and trigger power, brightness, or quick colors over the local network. Those helper functions (`goveePower`, `goveeSetColor`, `goveeSetWarmWhite`, etc.) accept optional IP/port overrides when used from kid-mode buttons so each button can target its own strip. LAN control now routes through the Tauri `govee_send` command (with a matching browser fallback), so desktop builds work without additional plugins.

### Collaboration Tips

- Treat `toddler-content.json` as data: contributors can branch from `main`, run `npm run content -- add-*`, and open a PR that only updates the JSON (and optionally screenshots/assets). After merging, the remote raw URL instantly delivers the new buttons to every build.
- If you keep content on a dedicated branch (e.g., `kid-content`), set the raw URL to `https://raw.githubusercontent.com/<org>/<repo>/<branch>/toddler-content.json`. The app will re-fetch on every launch and fall back to cached data if offline.
- Remember to run `npm run build` (or let `npm run tauri:build` do it for you) after updating toddler content so the native bundles ship with the latest defaults.

## Finding Your Roku IP

1. On your Roku, go to **Settings**
2. Select **Network**
3. Choose **About**
4. Note the IP address and add port `:8060` if your Roku doesn’t display one (for example `192.168.1.120:8060`)

## API Endpoints Used

- `GET /query/device-info` - Device information
- `GET /query/apps` - List installed apps
- `POST /launch/{app-id}` - Launch an app
- `POST /keypress/{key}` - Send remote button press

## Supported Keys

- Navigation: Up, Down, Left, Right, Select, Back, Home
- Playback: Play, Pause, Rev, Fwd, InstantReplay
- Volume: VolumeUp, VolumeDown, VolumeMute
- Power: PowerOff
- Misc: Info, ChannelUp, ChannelDown

## Future Enhancements

- Sound playback functionality
- Keyboard text input
- App favorites/quick launch
- Multiple Roku device support
- Custom macros/sequences
- Native RoomSense scanning via the `roomsense_scan` bridge
