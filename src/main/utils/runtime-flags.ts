import { resolveStartupRuntimeFlags } from "@main/startup";

const runtimeFlags = resolveStartupRuntimeFlags();

export function getStartupRuntimeFlags() {
  return runtimeFlags;
}

export function getStartupProfile() {
  return runtimeFlags.profile;
}

export function isSafeModeEnabled() {
  return runtimeFlags.safeMode;
}

export function isMinimalStartupEnabled() {
  return runtimeFlags.minimalStartup;
}

export function isGpuDisabled() {
  return runtimeFlags.disableGpu;
}

export function isTrayDisabled() {
  return runtimeFlags.disableTray;
}

export function isHotkeysDisabled() {
  return runtimeFlags.disableHotkeys;
}

export function isVerboseLoggingEnabled() {
  return isSafeModeEnabled() || process.env.CRAFTVOICE_VERBOSE_LOGGING === "1";
}
