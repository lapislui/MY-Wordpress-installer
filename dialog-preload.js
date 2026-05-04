const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dialogAPI", {
  sendBookmarkDialogResult: (payload) => ipcRenderer.send("browser:bookmark-dialog-result", payload),
  sendTabNicknameDialogResult: (payload) => ipcRenderer.send("browser:tab-nickname-dialog-result", payload)
});
