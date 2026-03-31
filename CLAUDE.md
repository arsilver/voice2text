# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CraftVoice — local-first desktop voice dictation app for Windows. Hold a global hotkey (Alt+D), speak, and transcribed text is copied to clipboard or pasted into the focused app. Built with Electron 40, React 19, Vite 7, TypeScript 5.9.

## Commands

```bash
# Development
npm run dev                # Full dev mode (all processes + Electron)
npm run dev:main           # Watch main process only
npm run dev:renderer       # Vite dev server only

# Build & Package
npm run build              # Build all (main, preload, renderer)
npm run package:win        # NSIS + portable installers → release/
npm run package:dir        # Test build without installer

# Test
npm run test               # Compile to tmp/test-dist/ then run with node --test
npm run typecheck          # TypeScript check only

# Assets (whisper.cpp binaries + models, not in repo)
npm run assets:download    # Download both whisper binary and default model
npm run whisper:download   # Download whisper.cpp only
npm run model:download     # Download model only
```

No ESLint or Prettier configured. TypeScript strict mode is the primary code quality gate.

Tests use Node.js built-in test runner (`node --test`), not Jest/Vitest. Test files live next to source: `*.test.ts`.

## Architecture

**Electron multi-process model with three Vite build targets:**

- **Main process** (`src/main/`) — Node.js: app lifecycle, global hotkeys, transcription routing, SQLite DB, OS integration (paste via nut.js, tray, clipboard)
- **Preload** (`src/preload/`) — `contextBridge` exposes `window.craftvoice` API (~50 methods across 8 namespaces). This is the only IPC boundary between renderer and main.
- **Renderer** (`src/renderer/`) — React 19 + Tailwind: dashboard, settings, history, dictionary, prompts pages
- **Widget** (`src/widget/`) — Separate frameless BrowserWindow, always-on-top floating recorder with waveform
- **Shared** (`src/shared/`) — Types, constants, provider config shared between processes

### Transcription Pipeline

Recording flow: hotkey press → Web Audio API + AudioWorklet captures 16kHz mono PCM in renderer → on release, WAV buffer sent to main process → routed to provider (local whisper.cpp or cloud API) → dictionary replacements applied → clipboard copy / Ctrl+V paste → saved to SQLite.

Providers (with fallback chain): whisper-local (whisper.cpp sidecar binary), OpenAI (gpt-4o-transcribe), Groq (whisper-large-v3), Deepgram (nova-3). Both batch upload and live WebSocket streaming modes supported.

### Database

SQLite via better-sqlite3 (synchronous, main process only). Schema in `src/main/db/schema.sql`: tables for transcriptions, dictionary_entries, prompt_cards, settings. API keys encrypted with Electron `safeStorage`.

### Widget Window

The widget is a frameless always-on-top BrowserWindow managed by `src/main/windows.ts`. A "widget guard" interval re-pins it every 10 seconds. Key invariants:

- The widget `show` event handler must never call `showInactive()` — doing so triggers a recursive `show` event loop that floods the event loop and crashes the process. The handler only re-pins (`setAlwaysOnTop` + `moveTop`).
- The widget guard interval calls `getSettings()` (DB access) so it must be stopped before `closeDb()` in the `before-quit` handler.
- `window-all-closed` handler is intentionally empty — the app lives in the tray and should not quit when windows close.
- `render-process-gone` auto-reloads the crashed renderer (up to 3 attempts). This handles Windows console signals (`STATUS_CONTROL_C_EXIT`) that kill renderer processes while the main process survives.
- The electron-launcher uses `detached: true` on Windows to isolate Electron from the console process group, preventing console close signals from killing renderer processes.

### Key Design Decisions

- whisper.cpp spawned as child process, not compiled in — process isolation
- better-sqlite3 chosen for synchronous performance in main process
- nut.js for reliable Windows keyboard simulation (paste)
- Batch API calls (single POST after recording) preferred for reliability over streaming
- Context-isolated preload enforces secure IPC boundary

## Path Aliases (tsconfig.json)

`@main/*`, `@preload/*`, `@renderer/*`, `@shared/*`, `@widget/*` → `src/<name>/*`

## Build Configs

Three separate Vite configs: `vite.main.config.ts` (Node/ESM), `vite.preload.config.ts` (CJS), `vite.renderer.config.ts` (client + React plugin). Packaging via electron-builder (`electron-builder.yml`).

## Native Modules

`better-sqlite3` and `@nut-tree-fork/nut-js` require native rebuild. `npm run postinstall` handles this via electron-rebuild.
