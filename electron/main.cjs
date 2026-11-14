const { app, BrowserWindow, shell, session, desktopCapturer, dialog } = require("electron");
const path = require("node:path");

const API_URL = process.env.NEXUS_API_URL || "https://secure-web-gateway--c00le5tp3rs0n3v.replit.app";
const API_ORIGIN = new URL(API_URL).origin;
const LOCAL_UI = path.join(__dirname, "..", "dist", "public", "index.html");

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
    backgroundColor: "#09090f",
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
    if (targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) {
      event.preventDefault();
      openExternalSafely(targetUrl);
    }
  });
  mainWindow.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    mainWindow?.setTitle("NEXUS");
  });

  mainWindow.loadFile(LOCAL_UI).catch((error) => {
    console.error("Unable to load bundled NEXUS interface:", error);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.nexusos.app");
  // Let Chromium's getDisplayMedia() use the native OS picker for desktop sharing.
  // The user chooses a screen/window; NEXUS never silently captures a display.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 } });
      if (!sources.length) return callback({});
      const choice = await dialog.showMessageBox(mainWindow, {
        type: "question",
        title: "Share your screen with NEXUS",
        message: "Choose the screen or window you want to share.",
        buttons: [...sources.map(source => source.name), "Cancel"],
        cancelId: sources.length,
        defaultId: 0,
        noLink: true
      });
      if (choice.response < 0 || choice.response >= sources.length) return callback({});
      callback({ video: sources[choice.response] });
    } catch (error) {
      console.error("NEXUS screen capture permission failed:", error);
      callback({});
    }
  }, { useSystemPicker: true });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    let trustedOrigin = false;
    try {
      const current = new URL(webContents.getURL());
      trustedOrigin = current.protocol === "file:" || current.origin === API_ORIGIN;
    } catch {}
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
