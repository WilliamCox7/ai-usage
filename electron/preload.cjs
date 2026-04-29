const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aiUsage", {
  read: () => ipcRenderer.invoke("usage:read"),
});
