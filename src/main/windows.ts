import electron from "electron";
import electronMain from "electron/main";

import { getSettings } from "@main/db/settings";
import { APP_NAME } from "@shared/constants";
import { getLogger } from "@main/utils/logger";
import { createAppIcon } from "@main/utils/icon";
import { getPreloadPath, getRendererHtmlPath } from "@main/utils/paths";
import type { StartupProfile } from "@shared/types";

let mainWindow: Electron.BrowserWindow | null = null;
let widgetWindow: Electron.BrowserWindow | null = null;
let widgetGuardInterval: NodeJS.Timeout | null = null;
let diagnosticsContext: {
  launchId: string;
  startupProfile: StartupProfile;
} | null = null;
const log = getLogger("windows");
const { shell } = electron;
const { BrowserWindow } = electronMain;

function getRendererUrlArg() {
  return process.argv.find((arg) => arg.startsWith("--renderer-url="))?.split("=")[1] ?? null;
}

async function loadWindow(window: Electron.BrowserWindow, fileName: "index.html" | "widget.html", hash = "") {
  const rendererUrl = getRendererUrlArg();

  if (rendererUrl) {
    const url = new URL(fileName, `${rendererUrl}/`);
    if (hash) {
      url.hash = hash;
    }
    await window.loadURL(url.toString());
    return;
  }

  await window.loadFile(getRendererHtmlPath(fileName), hash ? { hash } : undefined);
}

function attachWindowDiagnostics(window: Electron.BrowserWindow, label: "main" | "widget") {
  let rendererCrashCount = 0;

  const logLifecycle = (event: string, details?: Record<string, unknown>) => {
    log.info("Window lifecycle", withDiagnosticsContext({
      event,
      window: label,
      ...(details ?? {}),
    }));
  };

  window.on("show", () => {
    logLifecycle("show");
  });

  window.on("focus", () => {
    logLifecycle("focus");
  });

  window.on("blur", () => {
    logLifecycle("blur");
  });

  window.on("unresponsive", () => {
    log.error("Window lifecycle", withDiagnosticsContext({ event: "unresponsive", window: label }));
  });

  window.on("responsive", () => {
    logLifecycle("responsive");
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) {
      return;
    }

    log.error(`${label} window failed to load`, withDiagnosticsContext({ errorCode, errorDescription, validatedURL, window: label }));
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    log.error(`${label} renderer exited unexpectedly`, withDiagnosticsContext({ ...details, window: label }));

    if (window.isDestroyed()) {
      return;
    }

    // Reload the renderer after a short delay to recover from crashes.
    // Cap at 3 attempts to avoid infinite crash-reload loops.
    rendererCrashCount++;
    if (rendererCrashCount > 3) {
      log.error(`${label} renderer crashed too many times, giving up`, withDiagnosticsContext({ window: label }));
      return;
    }

    const attempt = rendererCrashCount;
    setTimeout(() => {
      if (!window.isDestroyed()) {
        log.info(`Reloading ${label} renderer after crash (attempt ${attempt})`, withDiagnosticsContext({ window: label }));
        window.webContents.reload();
      }
    }, 1500);
  });

  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    log.error(`${label} preload failed`, withDiagnosticsContext({ preloadPath, window: label }), error);
  });

  window.webContents.on("dom-ready", () => {
    logLifecycle("dom-ready");
  });

  window.webContents.on("did-finish-load", () => {
    logLifecycle("did-finish-load");
  });

  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (!message.startsWith("[CraftVoice]") && level < 2) {
      return;
    }

    const payload = {
      ...withDiagnosticsContext(),
      level: mapConsoleLevel(level),
      line,
      message,
      sourceId,
      window: label,
    };

    if (level >= 3) {
      log.error("Renderer console", payload);
      return;
    }

    if (level === 2) {
      log.warn("Renderer console", payload);
      return;
    }

    log.info("Renderer console", payload);
  });
}

export async function createMainWindow() {
  if (mainWindow) {
    return mainWindow;
  }

  log.info("Creating main window", withDiagnosticsContext({ window: "main" }));
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1160,
    minHeight: 760,
    show: false,
    autoHideMenuBar: true,
    title: APP_NAME,
    backgroundColor: "#090909",
    icon: createAppIcon(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  attachWindowDiagnostics(mainWindow, "main");
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("ready-to-show", () => {
    log.info("Window lifecycle", withDiagnosticsContext({ event: "ready-to-show", window: "main" }));
    mainWindow?.show();
  });

  mainWindow.webContents.on("did-finish-load", () => {
    if (!mainWindow) {
      return;
    }

    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
  });

  // Build a minimal hidden menu that preserves Edit accelerators
  // (Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+A). Without this, Electron drops
  // keyboard shortcuts when the menu bar is hidden.
  const { Menu } = electronMain;
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await loadWindow(mainWindow, "index.html", "/overview");
  return mainWindow;
}

export async function createWidgetWindow() {
  if (widgetWindow) {
    return widgetWindow;
  }

  log.info("Creating widget window", withDiagnosticsContext({ window: "widget" }));
  // Always tall enough for shell + improver action bar (tool / Improve / Copy).
  widgetWindow = new BrowserWindow({
    width: 240,
    height: 100,
    minWidth: 240,
    minHeight: 100,
    maxWidth: 240,
    maxHeight: 100,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    title: `${APP_NAME} Widget`,
    backgroundColor: "#00000000",
    icon: createAppIcon(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  attachWindowDiagnostics(widgetWindow, "widget");
  widgetWindow.on("closed", () => {
    widgetWindow = null;
    stopWidgetGuard();
  });
  widgetWindow.on("show", () => {
    // Re-pin without calling showInactive() to avoid recursive show loop.
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.setAlwaysOnTop(true, "screen-saver");
      widgetWindow.moveTop();
    }
  });
  widgetWindow.on("restore", () => {
    pinWidgetWindow(true);
  });
  widgetWindow.webContents.on("did-finish-load", () => {
    pinWidgetWindow(false);
  });

  widgetWindow.setMenuBarVisibility(false);
  startWidgetGuard();

  await loadWindow(widgetWindow, "widget.html");
  return widgetWindow;
}

export function getMainWindow() {
  return mainWindow;
}

export function getWidgetWindow() {
  return widgetWindow;
}

export function showMainWindow() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
  log.info("Main window shown", withDiagnosticsContext({ window: "main" }));
}

export function hideMainWindow() {
  mainWindow?.hide();
  log.info("Main window hidden", withDiagnosticsContext({ window: "main" }));
}

export function setWidgetVisibility(visible: boolean) {
  if (visible && !widgetWindow) {
    void createWidgetWindow()
      .then(() => {
        if (widgetWindow) {
          log.info("Widget visibility changed", withDiagnosticsContext({ visible: true, window: "widget" }));
          pinWidgetWindow(true);
        }
      })
      .catch((error) => {
        log.error("Failed to create widget window", withDiagnosticsContext({ window: "widget" }), error);
      });
    return;
  }

  if (!widgetWindow) {
    return;
  }

  if (visible) {
    log.info("Widget visibility changed", withDiagnosticsContext({ visible: true, window: "widget" }));
    pinWidgetWindow(true);
  } else {
    widgetWindow.hide();
    log.info("Widget visibility changed", withDiagnosticsContext({ visible: false, window: "widget" }));
  }
}

export function setWidgetExpanded(expanded: boolean) {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    return;
  }

  // Action bar (improver tool + Improve + Copy) stays visible at all times.
  // `expanded` is kept for IPC compatibility; both states use the full height.
  const height = expanded ? 100 : 100;
  widgetWindow.setMinimumSize(240, height);
  widgetWindow.setMaximumSize(240, height);
  widgetWindow.setSize(240, height);
}

export function broadcast(channel: string, payload?: unknown) {
  mainWindow?.webContents.send(channel, payload);
  widgetWindow?.webContents.send(channel, payload);
}

export function setWindowDiagnosticsContext(context: { launchId: string; startupProfile: StartupProfile }) {
  diagnosticsContext = context;
}

function pinWidgetWindow(ensureVisible: boolean) {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    return;
  }

  widgetWindow.setAlwaysOnTop(true, "screen-saver");
  widgetWindow.moveTop();

  if (ensureVisible || widgetWindow.isVisible()) {
    widgetWindow.showInactive();
  }
}

function startWidgetGuard() {
  stopWidgetGuard();

  widgetGuardInterval = setInterval(() => {
    if (!widgetWindow || widgetWindow.isDestroyed()) {
      stopWidgetGuard();
      return;
    }

    try {
      if (getSettings().showFloatingWidget) {
        pinWidgetWindow(true);
      }
    } catch {
      // DB may be unavailable during shutdown — don't crash
    }
  }, 10000);
}

export function stopWidgetGuard() {
  if (!widgetGuardInterval) {
    return;
  }

  clearInterval(widgetGuardInterval);
  widgetGuardInterval = null;
}

function mapConsoleLevel(level: number) {
  switch (level) {
    case 3:
      return "error";
    case 2:
      return "warn";
    case 1:
      return "info";
    default:
      return "debug";
  }
}

function withDiagnosticsContext(payload?: Record<string, unknown>) {
  if (!diagnosticsContext) {
    return payload ?? {};
  }

  return {
    launchId: diagnosticsContext.launchId,
    startupProfile: diagnosticsContext.startupProfile,
    ...(payload ?? {}),
  };
}
