const { app, BrowserWindow, shell, session } = require("electron");
const path = require("node:path");

const APP_URL = process.env.NEXUS_APP_URL || "https://secure-web-gateway--c00le5tp3rs0n3v.replit.app";
const APP_ORIGIN = new URL(APP_URL).origin;

let mainWindow;

function openExternalSafely(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return shell.openExternal(url.toString());
    }
  } catch {
    // Ignore malformed or unsupported URLs.
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 360,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#09090b",
    title: "NEXUS",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin !== APP_ORIGIN) {
        event.preventDefault();
        openExternalSafely(targetUrl);
      }
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    mainWindow?.setTitle("NEXUS");
  });

  mainWindow.loadURL(APP_URL).catch((error) => {
    console.error("Unable to load NEXUS:", error);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.nexusos.app");
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    let trustedOrigin = false;
    try { trustedOrigin = new URL(webContents.getURL()).origin === APP_ORIGIN; } catch {}
    callback(trustedOrigin && ["notifications", "media"].includes(permission));
  });
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
