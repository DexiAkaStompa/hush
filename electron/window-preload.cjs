const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hushWindow", {
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
});
