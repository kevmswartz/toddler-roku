# Toddler Phone Control

Toddler Phone Control is a family-friendly Roku remote that lets caregivers curate exactly what a preschooler can do on the TV, then locks the advanced settings behind a grown-up PIN. The app ships as a Tauri desktop bundle and an Android APK so the controls can run on a cheap phone, a wall-mounted tablet, or a living-room PC without involving cloud services.

## Why It Exists
- Kids want autonomy, but handing over the real Roku remote usually ends with unwanted purchases or late-night screen time. This project builds a safe “kid mode” surface with bright tiles, timers, and celebration screens so little ones stay on task while adults keep control.
- By running completely on the local network, it avoids privacy risks and works even when the internet cuts out. You can preload your own toddler buttons (cartoons, timers, “lights off” macros) and keep everything offline.

## What You Get
- A responsive remote with the full Roku External Control Protocol: navigation, app launch, playback, power, and volume.
- Curated kid buttons sourced from `toddler-content.json` or a remote GitHub raw URL; new buttons appear instantly after a refresh.
- Macros for bedtime or “clean up” routines that string multiple Roku key presses, launch apps, and trigger celebratory fireworks.
- Native LAN bridges for Roku and Govee lights, bypassing browser CORS limitations so light toggles, brightness, and color scenes work reliably.
- A PIN-protected grown-up mode that unlocks connection settings, content sources, macros, and diagnostics for when you need to tweak the setup.

## Tech Stack at a Glance
- **UI**: Hand-crafted HTML, vanilla JS, and Tailwind CSS compiled through `npm run build` into the `dist/` bundle showcased at [kevmswartz.github.io/toddler-phone-control](https://github.com/kevmswartz/toddler-phone-control/).
- **Native Shell**: Tauri 2 with a Rust command layer (`roku_get`, `roku_post`, `govee_send`, `govee_discover`) so network calls run locally on macOS, Windows, and Android.
- **Automation**: Node-based scripts (`scripts/build.js`, `scripts/toddler-content-cli.js`) keep the build reproducible and provide a CLI for updating the kid button catalog.
- **Assets**: Canvas fireworks, haptics-ready button feedback, and optional confetti for positive reinforcement moments.

## Quick Start
1. Install Node 18+: `npm install`
2. Build the UI bundle: `npm run build` (or `npm run dev` during active development)
3. Launch locally: `npm run tauri:dev` for the desktop shell or `npm run tauri:build` / `npm run android:build` for distributables
4. Point the app at your Roku’s IP (`Settings → Network → About`), unlock the gear icon with the PIN (default `1234`), and paste either a local `toddler-content.json` path or a remote GitHub raw URL.

## Where to Learn More
- Screens, UX notes, and additional context live on the companion site in the Toddler Phone Control repo: [kevmswartz/toddler-phone-control](https://github.com/kevmswartz/toddler-phone-control/).
- Release artifacts from this repo (`roku-control.exe`, signed `app-release-signed.apk`) let you sideload an inexpensive Android phone so “the toddler remote” is a sealed device with only the approved experiences.

Built so your kid can tap the Baby Shark button without accidentally opening HBO. Enjoy the calm.
