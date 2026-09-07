# CraftVoice (Copy_Voice2Text) — Hosts & Ports

## Services

| Service | Host | Port | Protocol | Description |
|---------|------|------|----------|-------------|
| **Renderer (Vite dev)** | `127.0.0.1` | `5178` | HTTP | React SPA dev server (Electron renderer) |
| **Electron Main Process** | N/A | N/A | IPC | Main process — hotkeys, recording, transcribe, paste, SQLite |
| **Whisper CLI (subprocess)** | N/A | N/A | stdio | Local whisper-cli.exe for transcription (no network) |

## Network Topology

```
Electron App (CraftVoice)
  │
  ├── http://127.0.0.1:5178  ──► Vite dev server (renderer + widget, dev only)
  │       └── rollup inputs: index.html, widget.html
  │
  ├── IPC (contextBridge)    ──► Electron main process
  │     ├── hotkeys          (globalShortcut register/unregister)
  │     ├── recording        (microphone capture state machine)
  │     ├── transcribe       (whisper-cli subprocess)
  │     ├── paste            (@nut-tree-fork/nut-js input injection)
  │     ├── db/settings      (better-sqlite3 local DB)
  │     └── tray             (system tray icon + menu)
  │
  └── Subprocess (no network) ──► whisper-cli.exe
        └── working dir: %APPDATA%\craftvoice\resources\whisper\Release
```

## Configuration Sources

| Setting | Location | Value |
|---------|----------|-------|
| Vite port | `vite.renderer.config.ts` → `server.port` | `5178` (strictPort: true) |
| Wait-on target | `package.json` → `scripts.dev:electron` | `tcp:127.0.0.1:5178` |
| Renderer URL | `package.json` → `scripts.dev:electron` | `http://127.0.0.1:5178` |
| Electron main | `package.json` → `main` | `dist/main/index.mjs` |
| Preload | `src/main/utils/paths.ts` → `getPreloadPath` | `dist/preload/index.cjs` |
| User data dir | `src/main/utils/paths.ts` → `getPreferredUserDataDir` | `%APPDATA%\craftvoice` |
| SQLite DB | `src/main/utils/paths.ts` → `getDatabasePath` | `%APPDATA%\craftvoice\craftvoice.db` |
| Logs | `src/main/utils/paths.ts` → `getLogsDir` | `%APPDATA%\craftvoice\logs` |
| Crash dumps | `src/main/utils/paths.ts` → `getCrashDumpsDir` | `%APPDATA%\craftvoice\crash-dumps` |
| Whisper exe | `src/main/utils/paths.ts` → `getWhisperExecutablePath` | `%APPDATA%\craftvoice\resources\whisper\Release\whisper-cli.exe` |
| App ID (builder) | `electron-builder.yml` → `appId` | `com.craftvoice.desktop` |

## Port Selection Rationale

- `5173` was the original port but **collides with Antigravity Motion Design, agent_Stats, flight_Simulator, JS-deX**.
- With `strictPort: true`, CraftVoice would crash or load the wrong renderer when any of those projects was running first.
- Moved to `5178` (next free Vite slot after ExileTrade's `5177`) on 2026-04-22.
- `strictPort: true` retained — if something else grabs 5178, dev startup will fail loudly rather than silently loading the wrong app.

## Ports Reserved by Other Projects (registry as of 2026-04-22)

| Port | Project | Service |
|------|---------|---------|
| `5173` | Antigravity Motion Design | Frontend (Vite dev) |
| `5174` | Agent Trader | Frontend (Vite dev) |
| `5175` | ArtBuddy | Frontend (Vite dev) |
| `5176` | BitScape | Client (Vite dev) |
| `5177` | ExileTrade | Frontend (Vite dev) |

## Startup / Shutdown

| Action | Command |
|--------|---------|
| Dev mode | `npm run dev` |
| Build production | `npm run build` |
| Build Windows installer | `npm run package:win` |
| Portable build | `npm run package:dir` |

## Single-instance Lock

- `app.requestSingleInstanceLock()` in `src/main/index.ts` — prevents two CraftVoice instances running simultaneously. A second launch reveals the primary instance instead.
- Does NOT affect other Electron apps (separate appId).

## Global Hotkey Conflict Handling

- Registered via `electron.globalShortcut.register()` in `src/main/hotkeys.ts`.
- If another app already holds the configured accelerator, registration returns `false` and the hotkey is reported as "Unable to register — another app may already use it." in the status panel.
- This is non-fatal — no crash, hotkey just won't work until the conflict is resolved.
