const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cm', {
  state: () => ipcRenderer.invoke('tray:state'),
  refresh: () => ipcRenderer.invoke('tray:refresh'),
  openApp: () => ipcRenderer.invoke('tray:open'),
  quit: () => ipcRenderer.invoke('tray:quit'),
  resize: (height) => ipcRenderer.invoke('tray:resize', height),
});
