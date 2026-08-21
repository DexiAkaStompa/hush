const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hushPicker", {
  onSources: (callback) => {
    ipcRenderer.once("screen-picker:sources", (_event, sources) => callback(sources));
  },
  select: (sourceId) => {
    if (typeof sourceId === "string" && sourceId.length <= 256) ipcRenderer.send("screen-picker:select", sourceId);
  },
  cancel: () => ipcRenderer.send("screen-picker:cancel"),
});
