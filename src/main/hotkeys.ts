import electronMain from "electron/main";

import { getSettings } from "@main/db/settings";
import { getLogger } from "@main/utils/logger";
import type { HotkeyStatus } from "@shared/types";
import { getRecordingState, sendRecordingCommand, setRecordingState } from "./recording";

const log = getLogger("hotkeys");
const { globalShortcut } = electronMain;

let activeAccelerator = "";
let hotkeysEnabled = true;
let hotkeysDisabledReason = "";
let hotkeyStatus: HotkeyStatus = {
  accelerator: "",
  registered: false,
  message: "No hotkey configured.",
};

export function configureHotkeyRegistration(options: { enabled: boolean; reason?: string }) {
  hotkeysEnabled = options.enabled;
  hotkeysDisabledReason = options.reason ?? "";
  activeAccelerator = getSettings().hotkey;

  if (!hotkeysEnabled) {
    globalShortcut.unregisterAll();
    hotkeyStatus = {
      accelerator: activeAccelerator,
      registered: false,
      message: hotkeysDisabledReason || "Hotkeys are disabled for this launch.",
    };
    log.info("Hotkey registration disabled", {
      accelerator: activeAccelerator,
      reason: hotkeyStatus.message,
    });
  }

  return hotkeyStatus;
}

export function isHotkeyRegistrationEnabled() {
  return hotkeysEnabled;
}

export function registerHotkeys() {
  const settings = getSettings();
  activeAccelerator = settings.hotkey;

  if (!hotkeysEnabled) {
    hotkeyStatus = {
      accelerator: activeAccelerator,
      registered: false,
      message: hotkeysDisabledReason || "Hotkeys are disabled for this launch.",
    };
    log.info("Skipping hotkey registration", {
      accelerator: activeAccelerator,
      reason: hotkeyStatus.message,
    });
    return hotkeyStatus;
  }

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
  log.info("Toggle recording requested", { source, state });

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
