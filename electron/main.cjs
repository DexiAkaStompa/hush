const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { autoUpdater } = require("electron-updater");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "hush",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

app.enableSandbox();

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

let mainWindow = null;
let updateCheckTimer = null;
let updateDialogOpen = false;

function sendUpdateStatus(status, details = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("updates:status", { status, ...details });
}

function promptForDownloadedUpdate() {
  if (updateDialogOpen || !mainWindow || mainWindow.isDestroyed()) return;
  updateDialogOpen = true;
  void dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Aggiornamento Hush disponibile",
    message: "Una nuova versione di Hush è pronta per essere installata.",
    detail: "Puoi riavviare ora oppure continuare a usare questa versione. L'aggiornamento verrà installato alla prossima chiusura dell'app.",
    buttons: ["Riavvia ora", "Più tardi"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }).then(({ response }) => {
    if (response === 0) autoUpdater.quitAndInstall();
  }).catch(() => undefined).finally(() => {
    updateDialogOpen = false;
  });
}

function configureAutoUpdater() {
  if (!app.isPackaged || process.env.HUSH_DISABLE_AUTO_UPDATE === "1") return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => sendUpdateStatus("checking"));
  autoUpdater.on("update-available", (info) => sendUpdateStatus("available", { version: info.version }));
  autoUpdater.on("update-not-available", () => sendUpdateStatus("current"));
  autoUpdater.on("download-progress", (progress) => sendUpdateStatus("downloading", { percent: progress.percent }));
  autoUpdater.on("update-downloaded", (info) => {
    sendUpdateStatus("downloaded", { version: info.version });
    promptForDownloadedUpdate();
  });
  autoUpdater.on("error", (error) => {
    // Update failures must never prevent Hush from starting or being used.
    sendUpdateStatus("error", { message: error instanceof Error ? error.message : "Update check failed." });
  });

  const check = () => {
    void autoUpdater.checkForUpdates().catch(() => undefined);
  };
  check();
  updateCheckTimer = setInterval(check, 4 * 60 * 60 * 1000);
  updateCheckTimer.unref?.();
}

const publicLavalink = {
  host: process.env.HUSH_LAVALINK_HOST || "lavalink.jirayu.net",
  password: process.env.HUSH_LAVALINK_PASSWORD || "youshallnotpass",
};

function roundedWindowShape(window) {
  if (process.platform !== "win32" || !window || window.isDestroyed() || typeof window.setShape !== "function") return;
  if (window.isMaximized()) {
    window.setShape([]);
    return;
  }
  const { width, height } = window.getBounds();
  const radius = Math.min(28, Math.floor(Math.min(width, height) / 2));
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const edgeDistance = y < radius ? radius - y : y >= height - radius ? y - (height - 1 - radius) : 0;
    const inset = edgeDistance > 0
      ? Math.ceil(radius - Math.sqrt(Math.max(0, radius * radius - edgeDistance * edgeDistance)))
      : 0;
    if (width - inset * 2 > 0) rows.push({ x: inset, y, width: width - inset * 2, height: 1 });
  }
  window.setShape(rows);
}

function windowForEvent(event) {
  const candidate = BrowserWindow.fromWebContents(event.sender);
  return candidate && candidate === mainWindow ? candidate : null;
}

ipcMain.on("window:minimize", (event) => windowForEvent(event)?.minimize());
ipcMain.on("window:toggle-maximize", (event) => {
  const window = windowForEvent(event);
  if (!window) return;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});
ipcMain.on("window:close", (event) => windowForEvent(event)?.close());
ipcMain.handle("window:is-maximized", (event) => windowForEvent(event)?.isMaximized() ?? false);

ipcMain.handle("music:search", async (event, rawQuery, provider = "youtube") => {
  if (!windowForEvent(event) || typeof rawQuery !== "string") throw new Error("Richiesta non autorizzata.");
  const query = rawQuery.trim().slice(0, 200);
  if (query.length < 2) return [];
  const prefix = provider === "spotify" ? "spsearch:" : "ytsearch:";
  const endpoint = `https://${publicLavalink.host}/v4/loadtracks?identifier=${encodeURIComponent(`${prefix}${query}`)}`;
  const response = await net.fetch(endpoint, {
    headers: { Authorization: publicLavalink.password, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Lavalink ha risposto ${response.status}.`);
  const payload = await response.json();
  if (payload?.loadType === "loadfailed" || payload?.loadType === "error") {
    throw new Error(payload?.data?.message || "Ricerca musicale non disponibile.");
  }
  return Array.isArray(payload?.data)
    ? payload.data.slice(0, 8).map((track) => ({
      title: String(track?.info?.title || "Senza titolo").slice(0, 200),
      author: String(track?.info?.author || "").slice(0, 120),
      url: typeof track?.info?.uri === "string" ? track.info.uri : "",
      artworkUrl: typeof track?.info?.artworkUrl === "string" ? track.info.artworkUrl : null,
      length: Number.isFinite(track?.info?.length) ? track.info.length : 0,
    })).filter((track) => track.url.startsWith("https://"))
    : [];
});

function iconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar", "build", "icon.png")
    : path.join(__dirname, "..", "build", "icon.png");
}

function isTrustedUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "hush:" && url.hostname === "app") return true;
    return !app.isPackaged && url.origin === "http://127.0.0.1:5173";
  } catch {
    return false;
  }
}

function registerLocalProtocol() {
  protocol.handle("hush", (request) => {
    const url = new URL(request.url);
    const roots = {
      app: path.join(__dirname, "..", "dist"),
      internal: __dirname,
    };
    const root = roots[url.hostname];
    if (!root) return new Response("Not found", { status: 404 });

    const requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const resolvedRoot = path.resolve(root);
    let filePath = path.resolve(resolvedRoot, requestedPath);
    if (url.hostname === "app" && !path.extname(filePath)) filePath = path.join(resolvedRoot, "index.html");
    if (filePath !== resolvedRoot && !filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
      return new Response("Forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function chooseDisplaySource(parent) {
  return new Promise(async (resolve) => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });

    const picker = new BrowserWindow({
      parent,
      modal: true,
      width: 860,
      height: 620,
      minWidth: 620,
      minHeight: 460,
      show: false,
      title: "Scegli cosa condividere — Hush",
      backgroundColor: "#0b0f14",
      icon: iconPath(),
      webPreferences: {
        preload: path.join(__dirname, "picker-preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });

    let settled = false;
    const finish = (source) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener("screen-picker:select", onSelect);
      ipcMain.removeListener("screen-picker:cancel", onCancel);
      if (!picker.isDestroyed()) picker.close();
      resolve(source ?? null);
    };
    const onSelect = (event, sourceId) => {
      if (event.sender !== picker.webContents || typeof sourceId !== "string") return;
      finish(sources.find((source) => source.id === sourceId) ?? null);
    };
    const onCancel = (event) => {
      if (event.sender === picker.webContents) finish(null);
    };
    ipcMain.on("screen-picker:select", onSelect);
    ipcMain.on("screen-picker:cancel", onCancel);
    picker.on("closed", () => finish(null));
    picker.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    picker.webContents.on("will-navigate", (event) => event.preventDefault());
    picker.webContents.once("did-finish-load", () => {
      picker.webContents.send("screen-picker:sources", sources.map((source) => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
      })));
      picker.show();
    });
    await picker.loadURL("hush://internal/screen-picker.html");
  });
}

function configurePermissions() {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return isTrustedUrl(requestingOrigin) && ["media", "display-capture", "notifications", "fullscreen"].includes(permission);
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isTrustedUrl(webContents.getURL()) && ["media", "display-capture", "notifications", "fullscreen"].includes(permission));
  });
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!request.userGesture || !isTrustedUrl(request.securityOrigin) || !mainWindow) {
      callback({});
      return;
    }
    const source = await chooseDisplaySource(mainWindow);
    if (!source) {
      callback({});
      return;
    }
    callback({
      video: source,
      audio: process.platform === "win32" && request.audioRequested ? "loopbackWithMute" : undefined,
    });
  });
}

function configureContentSecurityPolicy() {
  session.defaultSession.webRequest.onBeforeSendHeaders({
    urls: ["https://www.youtube.com/*", "https://www.youtube-nocookie.com/*"],
  }, (details, callback) => {
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        Referer: "https://hush.app/",
      },
    });
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith("hush://")) return callback({ responseHeaders: details.responseHeaders });
    const policy = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://music.hush.contact https://*.youtube.com https://*.googlevideo.com https://open.spotify.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https:",
      "frame-src https://www.youtube-nocookie.com https://www.youtube.com https://open.spotify.com",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join("; ");
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy],
      },
    });
  });
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: "Hush",
    frame: false,
    transparent: true,
    roundedCorners: true,
    hasShadow: true,
    backgroundColor: "#00000000",
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "window-preload.cjs"),
      webSecurity: true,
      autoplayPolicy: "no-user-gesture-required",
      allowRunningInsecureContent: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  const sendMaximizedState = () => mainWindow?.webContents.send("window:maximized-change", mainWindow.isMaximized());
  mainWindow.on("maximize", sendMaximizedState);
  mainWindow.on("unmaximize", sendMaximizedState);
  mainWindow.on("resize", () => roundedWindowShape(mainWindow));
  roundedWindowShape(mainWindow);
  mainWindow.on("closed", () => { mainWindow = null; });

  if (process.env.VITE_DEV_SERVER_URL && !app.isPackaged) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadURL("hush://app/index.html");
  }
}

app.whenReady().then(async () => {
  registerLocalProtocol();
  configurePermissions();
  configureContentSecurityPolicy();
  await createMainWindow();
  configureAutoUpdater();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createMainWindow(); });
});

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  if (process.platform !== "darwin") app.quit();
});
