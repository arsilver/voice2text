import { broadcast } from "./windows";
import { IPC_CHANNELS, type RecordingCommand, type RecordingState } from "@shared/types";

let recordingState: RecordingState = "idle";
let recordingLevel = 0;

export function getRecordingState() {
  return recordingState;
}

export function setRecordingState(state: RecordingState) {
  recordingState = state;
  if (state !== "recording") {
    setRecordingLevel(0);
  }
  broadcast(IPC_CHANNELS.recordingStateChanged, state);
}

export function sendRecordingCommand(command: RecordingCommand) {
  broadcast(IPC_CHANNELS.recordingCommand, command);
}

export function setRecordingLevel(level: number) {
  const nextLevel = clamp01(level);
  recordingLevel = nextLevel;
  broadcast(IPC_CHANNELS.recordingLevelChanged, nextLevel);
}

export function getRecordingLevel() {
  return recordingLevel;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}
