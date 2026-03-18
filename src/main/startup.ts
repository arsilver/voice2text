import type { AppSettings, StartupProfile, StartupStage } from "../shared/types";

export const REQUIRED_STARTUP_STAGES: StartupStage[] = ["dom-ready", "app-mounted", "interactive"];
export const STARTUP_HEARTBEAT_TIMEOUT_MS = 5000;

export interface StartupRuntimeFlags {
  profile: StartupProfile;
  safeMode: boolean;
  minimalStartup: boolean;
  disableGpu: boolean;
  disableTray: boolean;
  disableHotkeys: boolean;
}

export interface StartupGateSnapshot {
  healthy: boolean;
  hotkeysAllowed: boolean;
  missingStages: StartupStage[];
  receivedStages: StartupStage[];
  timedOut: boolean;
  trayAllowed: boolean;
}

export interface StartupGateUpdate {
  changed: boolean;
  snapshot: StartupGateSnapshot;
}

export interface DeferredStartupServices {
  enableHotkeys: boolean;
  enableTray: boolean;
  showWidget: boolean;
}

type RuntimeEnv = Record<string, string | undefined>;

export function resolveStartupRuntimeFlags(env: RuntimeEnv = process.env): StartupRuntimeFlags {
  const safeMode = env.CRAFTVOICE_SAFE_MODE === "1";
  const minimalStartup = safeMode || env.CRAFTVOICE_MINIMAL_STARTUP === "1";

  return {
    profile: safeMode ? "safe" : minimalStartup ? "minimal" : "normal",
    safeMode,
    minimalStartup,
    disableGpu: safeMode || env.CRAFTVOICE_DISABLE_GPU === "1",
    disableTray: safeMode || env.CRAFTVOICE_DISABLE_TRAY === "1",
    disableHotkeys: safeMode || env.CRAFTVOICE_DISABLE_HOTKEYS === "1",
  };
}

export function createStartupGate(flags: Pick<StartupRuntimeFlags, "disableTray" | "disableHotkeys">) {
  const received = new Set<StartupStage>();
  let timedOut = false;

  function getSnapshot(): StartupGateSnapshot {
    const receivedStages = REQUIRED_STARTUP_STAGES.filter((stage) => received.has(stage));
    const missingStages = REQUIRED_STARTUP_STAGES.filter((stage) => !received.has(stage));
    const healthy = !timedOut && missingStages.length === 0;

    return {
      healthy,
      hotkeysAllowed: healthy && !flags.disableHotkeys,
      missingStages,
      receivedStages,
      timedOut,
      trayAllowed: healthy && !flags.disableTray,
    };
  }

  return {
    getSnapshot,
    markTimedOut() {
      if (timedOut) {
        return {
          changed: false,
          snapshot: getSnapshot(),
        } satisfies StartupGateUpdate;
      }

      timedOut = true;
      return {
        changed: true,
        snapshot: getSnapshot(),
      } satisfies StartupGateUpdate;
    },
    reportStage(stage: StartupStage) {
      if (received.has(stage)) {
        return {
          changed: false,
          snapshot: getSnapshot(),
        } satisfies StartupGateUpdate;
      }

      received.add(stage);
      return {
        changed: true,
        snapshot: getSnapshot(),
      } satisfies StartupGateUpdate;
    },
  };
}

export function resolveDeferredStartupServices(
  flags: Pick<StartupRuntimeFlags, "disableHotkeys" | "disableTray" | "safeMode">,
  snapshot: Pick<StartupGateSnapshot, "healthy">,
  settings: Pick<AppSettings, "showFloatingWidget">
): DeferredStartupServices {
  return {
    enableHotkeys: snapshot.healthy && !flags.disableHotkeys,
    enableTray: snapshot.healthy && !flags.disableTray,
    showWidget: snapshot.healthy && !flags.safeMode && settings.showFloatingWidget,
  };
}
