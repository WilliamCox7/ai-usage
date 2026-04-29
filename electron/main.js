import electron from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage } = electron;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_PATH = process.platform === "darwin"
  ? path.join(os.homedir(), "Library", "Application Support", "ai-usage", "state.json")
  : path.join(os.homedir(), ".config", "ai-usage", "state.json");
const CODEX_SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");

let mainWindow;
let codexTray;
let claudeTray;
let trayMenu;
let trayUpdateTimer;
const watchers = [];
let changeDebounceTimer = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    minWidth: 440,
    height: 375,
    minHeight: 375,
    maxHeight: 375,
    title: "AI Usage",
    frame: false,
    show: false,
    skipTaskbar: true,
    backgroundColor: "#111318",
    webPreferences: {
      preload: path.join(ROOT, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(ROOT, "electron", "renderer.html"));

  mainWindow.on("blur", () => {
    mainWindow.hide();
  });
}

function createTray() {
  trayMenu = Menu.buildFromTemplate([
    { label: "Quit", click: () => app.quit() },
  ]);

  codexTray = createProviderTray("codex", "Codex Usage");
  claudeTray = createProviderTray("claude", "Claude Usage");

  updateTrayTitle();
  trayUpdateTimer = setInterval(updateTrayTitle, 5000);
}

function createProviderTray(provider, tooltip) {
  const tray = new Tray(createProviderIcon(provider));
  tray.setToolTip(tooltip);
  tray.on("click", toggleWindow);
  tray.on("right-click", () => {
    tray.popUpContextMenu(trayMenu);
  });
  return tray;
}

function createProviderIcon(provider) {
  const image = nativeImage.createFromPath(
    path.join(ROOT, "electron", "assets", `${provider}.png`),
  );
  return image.resize({ width: 14, height: 14 });
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
    return;
  }

  positionWindowBelowTray();
  mainWindow.show();
  mainWindow.focus();
}

function positionWindowBelowTray() {
  const anchorTray = codexTray || claudeTray;
  if (!anchorTray || !mainWindow) return;
  const trayBounds = anchorTray.getBounds();
  const windowBounds = mainWindow.getBounds();
  const x = Math.round(
    trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2,
  );
  const y = Math.round(trayBounds.y + trayBounds.height + 8);
  mainWindow.setPosition(x, y, false);
}

function readUsage() {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [path.join(ROOT, "bin", "ai-usage.js"), "now", "--json"],
      {
        maxBuffer: 1024 * 1024,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }

        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}

ipcMain.handle("usage:read", async () => readUsage());

function notifyChanged() {
  if (changeDebounceTimer) return;
  changeDebounceTimer = setTimeout(() => {
    changeDebounceTimer = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("usage:changed");
    }
    updateTrayTitle();
  }, 250);
}

function watchPath(target, options) {
  if (!fs.existsSync(target)) return;
  try {
    const watcher = fs.watch(target, options, () => notifyChanged());
    watcher.on("error", () => {});
    watchers.push(watcher);
  } catch {
    // Recursive watch can fail on some filesystems — fall back silently.
  }
}

function startWatchers() {
  const stateDir = path.dirname(STATE_PATH);
  if (fs.existsSync(stateDir)) {
    watchPath(stateDir, { persistent: false });
  }
  watchPath(CODEX_SESSIONS_DIR, { persistent: false, recursive: true });
}

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    app.dock?.hide();
  }
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
  }
  createWindow();
  createTray();
  startWatchers();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      toggleWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // Keep the menu bar app alive until the tray Quit action is used.
});

app.on("before-quit", () => {
  if (trayUpdateTimer) clearInterval(trayUpdateTimer);
  for (const watcher of watchers) {
    try { watcher.close(); } catch {}
  }
  watchers.length = 0;
});

async function updateTrayTitle() {
  try {
    const report = await readUsage();
    updateProviderTrayTitles(report.providers || []);
  } catch {
    if (codexTray) setTrayTitle(codexTray, "--");
    if (claudeTray) setTrayTitle(claudeTray, "--");
  }
}

function updateProviderTrayTitles(providers) {
  const codex = providers.find((provider) => provider.id === "codex");
  const claude = providers.find((provider) => provider.id === "claude");
  if (codexTray) setTrayTitle(codexTray, formatProviderLeft(codex));
  if (claudeTray) setTrayTitle(claudeTray, formatProviderLeft(claude));
}

function setTrayTitle(tray, title) {
  tray.setTitle(`\x1b[1;37m ${title}\x1b[0m`, { fontType: "monospacedDigit" });
}

function formatProviderLeft(provider) {
  const source = provider?.rateLimits?.session;
  if (!source || source.leftPercent == null) return "—";
  return `${Math.round(Number(source.leftPercent))}%`;
}
