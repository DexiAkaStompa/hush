const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  Notification,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { autoUpdater } = require("electron-updater");

if (process.platform === "win32" && typeof app.setAppUserModelId === "function") {
  app.setAppUserModelId("app.hush.private");
}

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
let updateStatus = { status: "disabled", currentVersion: app.getVersion(), message: "Gli aggiornamenti sono disponibili nell’app installata." };
let updateCheckPromise = null;

async function checkForUpdates() {
  if (["disabled", "downloaded", "downloading", "available"].includes(updateStatus.status)) return updateStatus;
  if (!updateCheckPromise) {
    updateCheckPromise = autoUpdater.checkForUpdates().catch((error) => {
      sendUpdateStatus("error", { message: error instanceof Error ? error.message : "Verifica non riuscita." });
    }).finally(() => { updateCheckPromise = null; });
  }
  await updateCheckPromise;
  return updateStatus;
}

function sendUpdateStatus(status, details = {}) {
  updateStatus = { status, currentVersion: app.getVersion(), ...details };
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("updates:status", updateStatus);
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

  autoUpdater.setFeedURL({ provider: "github", owner: "DexiAkaStompa", repo: "hush" });
  sendUpdateStatus("idle");
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => sendUpdateStatus("checking"));
  autoUpdater.on("update-available", (info) => sendUpdateStatus("available", { version: info.version }));
  autoUpdater.on("update-not-available", () => sendUpdateStatus("current"));
  autoUpdater.on("download-progress", (progress) => sendUpdateStatus("downloading", { version: updateStatus.version, percent: progress.percent }));
  autoUpdater.on("update-downloaded", (info) => {
    sendUpdateStatus("downloaded", { version: info.version });
    promptForDownloadedUpdate();
  });
  autoUpdater.on("error", (error) => {
    // Update failures must never prevent Hush from starting or being used.
    sendUpdateStatus("error", { message: error instanceof Error ? error.message : "Update check failed." });
  });

  const check = () => {
    void checkForUpdates();
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
  return candidate && candidate === mainWindow && event.senderFrame === event.sender.mainFrame && isTrustedUrl(event.senderFrame.url) ? candidate : null;
}

ipcMain.handle("clipboard:write", (event, text) => {
  if (!windowForEvent(event) || typeof text !== "string" || text.length > 16384) throw new Error("Richiesta appunti non valida.");
  clipboard.writeText(text);
});
ipcMain.handle("updates:get-status", (event) => {
  if (!windowForEvent(event)) throw new Error("Richiesta non autorizzata.");
  return updateStatus;
});
ipcMain.handle("updates:check", (event) => {
  if (!windowForEvent(event)) throw new Error("Richiesta non autorizzata.");
  return checkForUpdates();
});
ipcMain.handle("updates:install", (event) => {
  if (!windowForEvent(event) || updateStatus.status !== "downloaded") throw new Error("Nessun aggiornamento pronto.");
  setImmediate(() => autoUpdater.quitAndInstall());
});

ipcMain.on("window:minimize", (event) => windowForEvent(event)?.minimize());
ipcMain.on("window:toggle-maximize", (event) => {
  const window = windowForEvent(event);
  if (!window) return;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});
ipcMain.on("window:close", (event) => windowForEvent(event)?.close());
ipcMain.handle("window:is-maximized", (event) => windowForEvent(event)?.isMaximized() ?? false);

ipcMain.handle("notification:show", async (event, options) => {
  if (!windowForEvent(event) || !options || typeof options !== "object") return;
  if (!Notification.isSupported()) return;

  const notif = new Notification({
    title: String(options.title || "Hush"),
    body: String(options.body || ""),
    silent: true,
    icon: iconPath(),
  });

  notif.on("click", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("notification:clicked");
    }
  });

  notif.show();
});

async function searchYouTubeDirect(query) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const response = await net.fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });
  if (!response.ok) throw new Error(`YouTube ha risposto ${response.status}`);
  const html = await response.text();
  const m = html.match(/var ytInitialData = ({.*?});<\/script>/s) || html.match(/ytInitialData = ({.*?});<\/script>/s);
  if (!m) return [];
  const data = JSON.parse(m[1]);
  const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const tracks = [];
  for (const section of contents) {
    const renderers = section.itemSectionRenderer?.contents || [];
    for (const r of renderers) {
      if (r.videoRenderer) {
        const v = r.videoRenderer;
        const lengthStr = v.lengthText?.simpleText || "";
        let lengthMs = 0;
        if (lengthStr) {
          const parts = lengthStr.split(":").map(Number);
          if (parts.length === 2) lengthMs = (parts[0] * 60 + parts[1]) * 1000;
          else if (parts.length === 3) lengthMs = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
        }
        const title = v.title?.runs?.[0]?.text || "Senza titolo";
        const author = v.ownerText?.runs?.[0]?.text || "";
        const artworkUrl = v.thumbnail?.thumbnails?.[v.thumbnail.thumbnails.length - 1]?.url || null;
        tracks.push({
          title: String(title).slice(0, 200),
          author: String(author).slice(0, 120),
          url: `https://www.youtube.com/watch?v=${v.videoId}`,
          artworkUrl,
          length: lengthMs,
        });
      }
    }
  }
  return tracks.slice(0, 10);
}

ipcMain.handle("music:search", async (event, rawQuery, provider = "youtube") => {
  if (!windowForEvent(event) || typeof rawQuery !== "string") throw new Error("Richiesta non autorizzata.");
  const query = rawQuery.trim().slice(0, 200);
  if (query.length < 2) return [];

  // 1. Direct YouTube search (instant, no third-party Lavalink dependency)
  try {
    const searchQuery = provider === "spotify" ? `${query} audio` : query;
    const directResults = await searchYouTubeDirect(searchQuery);
    if (directResults.length > 0) return directResults;
  } catch (err) {
    console.warn("Direct YouTube search error, trying Lavalink fallback:", err);
  }

  // 2. Fallback to Lavalink if available
  try {
    const prefix = provider === "spotify" ? "spsearch:" : "ytsearch:";
    const endpoint = `https://${publicLavalink.host}/v4/loadtracks?identifier=${encodeURIComponent(`${prefix}${query}`)}`;
    const response = await net.fetch(endpoint, {
      headers: { Authorization: publicLavalink.password, Accept: "application/json" },
    });
    if (response.ok) {
      const payload = await response.json();
      if (Array.isArray(payload?.data)) {
        return payload.data.slice(0, 8).map((track) => ({
          title: String(track?.info?.title || "Senza titolo").slice(0, 200),
          author: String(track?.info?.author || "").slice(0, 120),
          url: typeof track?.info?.uri === "string" ? track.info.uri : "",
          artworkUrl: typeof track?.info?.artworkUrl === "string" ? track.info.artworkUrl : null,
          length: Number.isFinite(track?.info?.length) ? track.info.length : 0,
        })).filter((track) => track.url.startsWith("https://"));
      }
    }
  } catch {
    // ignore
  }

  return [];
});

let gdriveConfigCache = null;
function getGDriveConfig() {
  if (gdriveConfigCache) return gdriveConfigCache;
  try {
    const candidatePaths = [
      path.join(app.getPath("userData"), "gdrive-config.json"),
      path.join(process.resourcesPath || "", "gdrive-config.json"),
      path.join(process.resourcesPath || "", "app", "gdrive-config.json"),
      path.join(__dirname, "..", "gdrive-config.json"),
      path.join(process.cwd(), "gdrive-config.json"),
      path.join(process.env.APPDATA || "", "Hush", "gdrive-config.json"),
      "c:\\Users\\matti\\Desktop\\code\\Hush-app\\gdrive-config.json",
    ];
    for (const p of candidatePaths) {
      if (p && fs.existsSync(p)) {
        gdriveConfigCache = JSON.parse(fs.readFileSync(p, "utf-8"));
        break;
      }
    }
  } catch {
    gdriveConfigCache = null;
  }
  return gdriveConfigCache;
}

async function getGDriveAccessToken() {
  const config = getGDriveConfig();
  if (!config?.GDRIVE_REFRESH_TOKEN) throw new Error("Google Drive non configurato.");
  const fetchFn = typeof fetch === "function" ? fetch : net.fetch;
  const res = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.GDRIVE_CLIENT_ID,
      client_secret: config.GDRIVE_CLIENT_SECRET,
      refresh_token: config.GDRIVE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error("Impossibile rinnovare il token Google Drive: " + (data.error_description || res.status));
  }
  return data.access_token;
}

ipcMain.handle("gdrive:is-configured", (event) => {
  if (!windowForEvent(event)) return false;
  const config = getGDriveConfig();
  return Boolean(config?.GDRIVE_REFRESH_TOKEN && config?.GDRIVE_FOLDER_ID);
});

ipcMain.handle("gdrive:upload", async (event, payload) => {
  if (!windowForEvent(event) || !payload || !payload.data) throw new Error("Richiesta non autorizzata.");
  const config = getGDriveConfig();
  if (!config?.GDRIVE_FOLDER_ID) throw new Error("Cartella Google Drive non configurata.");
  const accessToken = await getGDriveAccessToken();

  const boundary = "-------314159265358979323846";
  const delimiter = "\r\n--" + boundary + "\r\n";
  const closeDelim = "\r\n--" + boundary + "--";

  const metadata = JSON.stringify({
    name: String(payload.name || "attachment.bin"),
    parents: [config.GDRIVE_FOLDER_ID],
    mimeType: "application/octet-stream",
  });

  const fileData = Buffer.isBuffer(payload.data)
    ? payload.data
    : payload.data instanceof Uint8Array
      ? Buffer.from(payload.data.buffer, payload.data.byteOffset, payload.data.byteLength)
      : Buffer.from(payload.data);

  const multipartBody = Buffer.concat([
    Buffer.from(
      delimiter +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      metadata +
      delimiter +
      "Content-Type: application/octet-stream\r\n\r\n"
    ),
    fileData,
    Buffer.from(closeDelim),
  ]);

  const fetchFn = typeof fetch === "function" ? fetch : net.fetch;
  const uploadRes = await fetchFn("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || !uploadData.id) {
    throw new Error("Upload Google Drive non riuscito: " + (uploadData?.error?.message || uploadRes.status));
  }

  // Set file to anyone with the link can view
  await fetchFn(`https://www.googleapis.com/drive/v3/files/${uploadData.id}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  }).catch(() => undefined);

  const downloadUrl = `https://drive.usercontent.google.com/download?id=${uploadData.id}&export=download&authuser=0`;

  return {
    fileId: uploadData.id,
    downloadUrl,
  };
});

ipcMain.handle("gdrive:download", async (event, payload) => {
  if (!windowForEvent(event) || !payload || !payload.fileId) throw new Error("Richiesta non autorizzata.");
  const fileId = String(payload.fileId);
  const downloadUrls = [
    payload.downloadUrl,
    `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0`,
    `https://drive.google.com/uc?export=download&id=${fileId}`,
  ].filter(Boolean);

  const fetchFn = typeof fetch === "function" ? fetch : net.fetch;
  for (const url of downloadUrls) {
    try {
      const res = await fetchFn(url);
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        return Array.from(new Uint8Array(arrayBuf));
      }
    } catch {}
  }
  throw new Error("Impossibile scaricare l'allegato da Google Drive.");
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
    return isTrustedUrl(requestingOrigin) && ["media", "display-capture", "notifications", "fullscreen", "speaker-selection"].includes(permission);
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isTrustedUrl(webContents.getURL()) && ["media", "display-capture", "notifications", "fullscreen", "speaker-selection"].includes(permission));
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
      audio: process.platform === "win32" && request.audioRequested ? "loopback" : undefined,
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
      "script-src 'self' 'wasm-unsafe-eval'",
      "worker-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://music.hush.contact https://*.youtube.com https://*.googlevideo.com https://open.spotify.com https://*.googleapis.com https://drive.usercontent.google.com https://*.google.com",
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
