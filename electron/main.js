const electron = require("electron");

// If this file is run with `node` instead of the `electron` binary, `require("electron")` is not the API.
if (typeof electron !== "object" || !electron.app || typeof electron.app.requestSingleInstanceLock !== "function") {
  console.error(
    "Start the desktop app with: npm start\n(Do not run this file with plain `node` — use the Electron executable.)"
  );
  process.exit(1);
}

const { app, BrowserWindow, dialog, shell } = electron;

const path = require("path");
const fs = require("fs");

/** Shown in window title, task switcher (Windows/Linux); macOS display name comes from the built .app. */
const APP_DISPLAY_NAME = "ForeFold Report Generator";

let httpServer = null;
let serverPort = Number(process.env.PORT || 4000);

async function createWindow(port) {
  const iconPath = path.resolve(__dirname, "../assets/icon.png");
  const browserWindowOptions = {
    title: APP_DISPLAY_NAME,
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    // Avoid invisible window if ready-to-show never fires (e.g. renderer hang).
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  };
  if (fs.existsSync(iconPath)) {
    // Windows/Linux window/taskbar icon (macOS uses app bundle icon).
    browserWindowOptions.icon = iconPath;
  }

  const win = new BrowserWindow({
    ...browserWindowOptions,
  });

  const appOrigin = `http://127.0.0.1:${port}`;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url || url === "about:blank") {
      return { action: "deny" };
    }

    if (url.startsWith(`${appOrigin}/`)) {
      return { action: "allow" };
    }

    if (/^https?:\/\//i.test(url)) {
      // Open external links in the system browser instead of creating untrusted app windows.
      shell.openExternal(url).catch((error) => {
        console.error("Failed to open external link:", error);
      });
    }

    return { action: "deny" };
  });

  win.webContents.on("did-fail-load", (_event, code, desc, url) => {
    console.error("Window failed to load:", code, desc, url);
    dialog.showErrorBox(
      "Could not load app",
      `Failed to load ${url}.\n${desc || ""}\n\nIs the local server running on port ${port}?`
    );
  });

  await win.loadURL(`http://127.0.0.1:${port}/`);

  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.error(
    `${APP_DISPLAY_NAME} is already running. Close the other window or quit that process, then try again.`
  );
  try {
    dialog.showErrorBox(
      "Already running",
      `${APP_DISPLAY_NAME} is already open. Use the existing window or quit the app before starting again.`
    );
  } catch (_) {
    /* dialog may not be usable before ready in edge cases */
  }
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      app.setName(APP_DISPLAY_NAME);

      // Use a writable location in packaged apps (outside app.asar).
      process.env.APP_DATA_DIR = app.getPath("userData");
      // Ensures src/config/env.js uses user-writable paths (not read-only app.asar).
      process.env.FOREFOLD_IS_PACKAGED = app.isPackaged ? "1" : "0";
      const { startServer } = require("../src/server");
      const { server, port } = await startServer();
      httpServer = server;
      serverPort = port;
      await createWindow(serverPort);
    } catch (err) {
      console.error(err);
      await dialog.showMessageBox({
        type: "error",
        title: "Could not start",
        message: "The local server failed to start.",
        detail: String(err && err.message ? err.message : err),
      });
      app.quit();
      return;
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(serverPort);
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    if (httpServer) {
      httpServer.close();
      httpServer = null;
    }
  });
}
