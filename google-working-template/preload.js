const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  navigate: (url) => ipcRenderer.send('navigate', url),
  back: () => ipcRenderer.send('back'),
  forward: () => ipcRenderer.send('forward'),
  reload: () => ipcRenderer.send('reload'),
  toggleSourceView: () => ipcRenderer.invoke('toggle-source-view'),
  onUpdateUrl: (callback) => ipcRenderer.on('update-url', (_event, value) => callback(value)),
});
