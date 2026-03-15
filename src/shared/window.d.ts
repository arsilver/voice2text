import type { CraftVoiceApi } from "./types";

declare global {
  interface Window {
    craftvoice: CraftVoiceApi;
  }
}

export {};

