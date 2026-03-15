# CraftVoice Bootstrap Plan

## Summary

- Initialize a Windows-first Electron + React workspace for CraftVoice.
- Build the BridgeVoice-inspired shell, floating widget, and typed preload boundary.
- Implement the real local dictation loop first, then shape cloud fallback without blocking the local path.
- Persist history, dictionary, provider preferences, and encrypted API keys in SQLite.

## Initial milestones

1. Boot the desktop shell with secure Electron defaults and a live React UI.
2. Wire toggle hotkey recording, AudioWorklet capture, local Whisper transcription, dictionary replacement, and paste flow.
3. Expose live history, settings, dictionary, and provider-health data in the renderer.
4. Add scripted asset download for `whisper.cpp` and the default model.

## Deferred

- Packaging, updates, billing, auth, and cross-device sync
- True push-to-talk native key-up hooks
- Theme variants and advanced analytics

