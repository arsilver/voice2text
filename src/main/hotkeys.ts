import electronMain from "electron/main";

import { getSettings } from "@main/db/settings";
import { getLogger } from "@main/utils/logger";
import type { HotkeyStatus } from "@shared/types";
import { getRecordingState, sendRecordingCommand, setRecordingState } from "./recording";

const log = getLogger("hotkeys");
const { globalShortcut } = electronMain;

let activeAccelerator = "";
let hotkeyStatus: HotkeyStatus = {
  accelerator: "",
  registered: false,
  message: "No hotkey configured.",
};

export function registerHotkeys() {
  const settings = getSettings();
  activeAccelerator = settings.hotkey;

  if (!activeAccelerator) {
    hotkeyStatus = {
      accelerator: "",
      registered: false,
      message: "No hotkey configured.",
    };
    return hotkeyStatus;
  }

  const ok = globalShortcut.register(activeAccelerator, () => {
    void toggleRecording("hotkey");
  });

  if (!ok) {
    log.error(`Failed to register hotkey: ${activeAccelerator}`);
    hotkeyStatus = {
      accelerator: activeAccelerator,
      registered: false,
      message: `Unable to register ${activeAccelerator}. Another app may already use it.`,
    };
  } else {
    log.info(`Registered hotkey ${activeAccelerator}`);
    hotkeyStatus = {
      accelerator: activeAccelerator,
      registered: true,
      message: `${activeAccelerator} is registered and ready.`,
    };
  }

  return hotkeyStatus;
}

export function refreshHotkeys() {
  globalShortcut.unregisterAll();
  return registerHotkeys();
}

export function unregisterHotkeys() {
  globalShortcut.unregisterAll();
}

export function getHotkeyStatus() {
  return hotkeyStatus;
}

export async function toggleRecording(source: "hotkey" | "tray" | "widget" | "renderer") {
  const state = getRecordingState();

  if (state === "idle" || state === "error") {
    setRecordingState("recording");
    sendRecordingCommand("start");
    return "recording" as const;
  }

  if (state === "recording") {
    setRecordingState("transcribing");
    sendRecordingCommand("stop");
    return "transcribing" as const;
  }

  log.info(`Ignoring toggle from ${source} while state=${state}`);
  return state;
}
