const { app, BrowserWindow, dialog, shell } = require("electron");

let httpServer = null;
let serverPort = Number(process.env.PORT || 4000);

async function createWindow(port) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
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

  win.once("ready-to-show", () => win.show());
  await win.loadURL(`http://127.0.0.1:${port}/`);

  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
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
      // Use a writable location in packaged apps (outside app.asar).
      process.env.APP_DATA_DIR = app.getPath("userData");
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
