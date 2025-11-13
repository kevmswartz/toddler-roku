# Codex Suggestions

## 1. Ship the new modular code instead of the legacy monolith
- `scripts/build.js` currently just copies the hand-maintained `app.js` into `dist` (`scripts/build.js:10-118`), so none of the work under `src/` (modular Roku/Govee/content/state layers exported from `src/index.js`) is exercised in the runnable bundle.
- Adopt a small bundler step (esbuild, Vite, or Rollup) that treats `src/index.js` as the entry point, outputs the optimized bundle to `dist/app.js`, and lets you progressively delete dead code from the 5,700‑line monolith.
- Doing so unlocks tree-shaking, TypeScript (already listed in `devDependencies`), and proper module-scoped linting/testing, and prevents the two implementations from silently diverging.

## 2. Fix `StateManager.reset()` wiping the whole store
- Calling `state.reset()` assigns `this._state = this.constructor.prototype._state` (`src/utils/state.js:179-183`), but `_state` only exists on instances, so the reset sets `_state` to `undefined` and every `state.get()` starts throwing afterwards.
- Capture a deep clone of the initial tree in the constructor (e.g. `this._initialState = structuredClone(initialState)`), and have `reset()` clone that snapshot back while preserving `Map` instances.
- With a reliable reset you can finally write deterministic unit tests around the store without reloading the entire page between cases.

## 3. Make `forceRefresh` actually bust cached kid-mode content
- `ContentManager.loadContent()` accepts `{ forceRefresh }` but never reads it (`src/modules/content.js:204-291`), so callers cannot force a refetch after editing `public/config/toddler/custom.json` or a Netlify payload.
- Honor the flag by short-circuiting on `this.currentConfig` only when `forceRefresh` is false, append a cache-busting query param when hitting the cloud endpoint, and optionally allow `storage` to persist a last-modified hash so the UI can tell the user whether they are looking at fresh or stale buttons.
- This will remove the current workaround of restarting the entire Tauri shell to pull new kid-mode layouts.

## 4. Wire up a real unit test runner for the new modules
- You already authored `src/modules/content.test.js`, `macros.test.js`, and `rooms.test.js`, but `package.json` has no `test` script and the repo never installs Jest/Vitest (`package.json:18-30`).
- Add `vitest` + `@vitest/ui` (JS DOM env) and a `"test": "vitest run"` script, and drop in a lightweight setup file that stubs `window`, `localStorage`, and `fetch` so the current tests (which already read like Vitest specs) can execute.
- Running these in CI will catch regressions in the refactored modules long before they make their way back into the giant `app.js`.

## 5. De-duplicate the Roku app catalog to avoid mismatches
- Both `roku.js` and `macros.js` declare their own `COMMON_APPS` arrays, and they already disagree (Disney+ is `41468` in `src/modules/roku.js:16-36` but `291097` in `src/modules/macros.js:14-27`), which means macros may label a launch step incorrectly.
- Export the canonical list from `roku.js` (or a standalone `config/apps.json`) and import it wherever human-readable names are needed so the IDs never diverge again.
- Once unified, you can hang metadata (icons, categories) off the same source and power richer UI without chasing multiple definitions.
