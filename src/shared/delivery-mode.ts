import type { AppSettings, DeliveryMode } from "./types";

type DeliverySettings = Pick<AppSettings, "autoPaste" | "autoCopyClipboard">;

export function getDeliveryMode(settings: DeliverySettings): DeliveryMode {
  return settings.autoPaste ? "paste-and-copy" : "copy";
}

export function getDeliveryModePatch(mode: DeliveryMode): DeliverySettings {
  if (mode === "paste-and-copy") {
    return {
      autoPaste: true,
      autoCopyClipboard: true,
    };
  }

  return {
    autoPaste: false,
    autoCopyClipboard: true,
  };
}
