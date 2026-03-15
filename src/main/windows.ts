import electron from "electron";
import electronMain from "electron/main";

import { getSettings } from "@main/db/settings";
import { APP_NAME } from "@shared/constants";
import { getLogger } from "@main/utils/logger";
import { createAppIcon } from "@main/utils/icon";
import { getPreloadPath, getRendererHtmlPath } from "@main/utils/paths";

let mainWindow: Electron.BrowserWindow | null = null;
let widgetWindow: Electron.BrowserWindow | null = null;
let widgetGuardInterval: NodeJS.Timeout | null = null;
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
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) {
      return;
    }

    log.error(`${label} window failed to load`, { errorCode, errorDescription, validatedURL });
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    log.error(`${label} renderer exited unexpectedly`, details);
  });

  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    log.error(`${label} preload failed`, preloadPath, error);
  });
}

export async function createMainWindow() {
  if (mainWindow) {
    return mainWindow;
  }

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

  widgetWindow = new BrowserWindow({
    width: 240,
    height: 72,
    minWidth: 240,
    minHeight: 72,
    maxWidth: 240,
    maxHeight: 72,
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
    pinWidgetWindow(true);
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
}

export function hideMainWindow() {
  mainWindow?.hide();
}

export function setWidgetVisibility(visible: boolean) {
  if (!widgetWindow) {
    return;
  }

  if (visible) {
    pinWidgetWindow(true);
  } else {
    widgetWindow.hide();
  }
}

export function broadcast(channel: string, payload?: unknown) {
  mainWindow?.webContents.send(channel, payload);
  widgetWindow?.webContents.send(channel, payload);
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

    if (getSettings().showFloatingWidget) {
      pinWidgetWindow(true);
    }
  }, 10000);
}

function stopWidgetGuard() {
  if (!widgetGuardInterval) {
    return;
  }

  clearInterval(widgetGuardInterval);
  widgetGuardInterval = null;
}
