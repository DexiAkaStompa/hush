const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hushWindow", {
  copyText: (text) => ipcRenderer.invoke("clipboard:write", text),
  getUpdateStatus: () => ipcRenderer.invoke("updates:get-status"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  onUpdateStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on("updates:status", handler);
    return () => ipcRenderer.removeListener("updates:status", handler);
  },
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onMaximizedChange: (listener) => {
    const handler = (_event, maximized) => listener(Boolean(maximized));
    ipcRenderer.on("window:maximized-change", handler);
    return () => ipcRenderer.removeListener("window:maximized-change", handler);
  },
  searchMusic: (query, provider) => ipcRenderer.invoke("music:search", query, provider),
  showNotification: (options) => ipcRenderer.invoke("notification:show", options),
  onNotificationClick: (listener) => {
    const handler = (_event) => listener();
    ipcRenderer.on("notification:clicked", handler);
    return () => ipcRenderer.removeListener("notification:clicked", handler);
  },
});
