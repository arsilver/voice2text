import electron from "electron";

import { getLogger } from "@main/utils/logger";

const log = getLogger("paste");
const { clipboard } = electron;

export async function pasteText(text: string) {
  clipboard.writeText(text);

  try {
    await waitForClipboard(text);
    const { keyboard, Key } = await import("@nut-tree-fork/nut-js");
    await keyboard.pressKey(Key.LeftControl, Key.V);
    await keyboard.releaseKey(Key.V, Key.LeftControl);
    return true;
  } catch (error) {
    log.warn("Auto-paste failed. Clipboard was still updated.", error);
    return false;
  }
}

async function waitForClipboard(expected: string, maxMs = 100, intervalMs = 10) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxMs) {
    if (clipboard.readText() === expected) {
      return;
    }

    await sleep(intervalMs);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
