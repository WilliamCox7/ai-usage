const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aiUsage", {
  read: () => ipcRenderer.invoke("usage:read"),
  onChanged: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("usage:changed", listener);
    return () => ipcRenderer.removeListener("usage:changed", listener);
  },
});
