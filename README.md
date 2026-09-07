# CraftVoice

CraftVoice is a local-first Windows desktop dictation app. Hold a global hotkey (Alt+D), speak naturally, and the transcribed text is copied to your clipboard (or pasted into the focused app).

## Your accounts stay on your machine

This repository is source code only. It does **not** contain anyone's API keys, transcripts, or recordings.

| What | Where it lives |
|------|----------------|
| OpenAI / Groq / Deepgram keys | `%APPDATA%\craftvoice\craftvoice.db` (encrypted) on **your** PC |
| Session history | same local database |
| Whisper models / binaries | downloaded locally via `npm run assets:download` |

After you clone and run the app, Settings starts empty. Add **your** keys there, or use Local Whisper with no key. Do not copy `%APPDATA%\craftvoice\` or a `.env` into git.

## Features

- **Multi-provider transcription** — OpenAI (gpt-4o-transcribe), Groq (whisper-large-v3), Deepgram (nova-3), and Local Whisper (whisper.cpp)
- **Automatic fallback** — if the selected provider fails, backups are tried in order; Local Whisper is always the last safety net
- **Batch transcription** — all providers use a single API call after recording stops for maximum reliability
- **Dictionary replacements** — auto-correct transcription output with custom word rules
- **Prompt cards** — store reusable prompt templates
- **Floating widget** — always-on-top overlay showing recording status and audio level
- **Hotkey toggle** — global Alt+D (configurable) to start/stop recording
- **Encrypted API keys** — stored with Electron safeStorage in SQLite
- **Session history** — paginated transcript history with copy/reinsert/delete
- **Dashboard metrics** — total words, speaking time, sessions, average pace

## Architecture

- **Electron 40** + **React 19** + **Vite** + **TypeScript**
- Main process: recording state machine, IPC handlers, SQLite database, transcription routing
- Renderer: React UI with HashRouter (Overview, Prompts, History, Dictionary, Shortcuts, Settings)
- Widget: separate React app in frameless always-on-top window
- Preload: secure contextBridge API (`window.craftvoice`)

## Transcription flow

1. User presses hotkey → renderer captures audio via Web Audio API + AudioWorklet
2. User presses hotkey again → recording stops, full WAV (16kHz mono) sent to main process
3. Main process sends WAV to selected provider's batch API (single HTTP POST)
4. If provider fails, tries next in fallback chain
5. Dictionary replacements applied to transcript
6. Text copied to clipboard (and optionally pasted via Ctrl+V)
7. Result saved to SQLite history

## Requirements

- Windows 10 or later
- Node.js 24+
- npm 11+
- Microphone access enabled for desktop apps

## Setup

```powershell
npm install
npm run assets:download
npm run dev
```

## Scripts

- `npm run dev` — start Vite watchers and Electron
- `npm run build` — build main, preload, and renderer bundles
- `npm run test` — run TypeScript compilation + unit tests
- `npm run package:win` — build Windows NSIS and portable artifacts into `release/`
- `npm run typecheck` — run TypeScript only
- `npm run assets:download` — fetch whisper.cpp Windows binaries and default model

## Provider setup

| Provider | API key required | Models | Free tier |
|----------|-----------------|--------|-----------|
| Local Whisper | No | ggml-base.en, ggml-small.en, ggml-medium.en | Always free (local) |
| OpenAI | Yes (API credits, separate from ChatGPT subscription) | gpt-4o-transcribe, gpt-4o-mini-transcribe | No |
| Groq | Yes | whisper-large-v3, whisper-large-v3-turbo | Yes (free tier) |
| Deepgram | Yes | nova-3, nova-2 | Yes ($200 credit on signup) |

## Notes

- API keys are encrypted with Electron `safeStorage` before being written to SQLite
- The OpenAI API requires separate billing from a ChatGPT subscription — add credits at https://platform.openai.com/settings/organization/billing
- All providers use batch-only transcription (single POST after recording stops) for reliability
- The first recording interaction is toggle mode because Electron global shortcuts do not emit key-up events
- Windows packaging expects Whisper binaries and models under `resources/`, copied by electron-builder

## License

MIT. See [LICENSE](LICENSE).
