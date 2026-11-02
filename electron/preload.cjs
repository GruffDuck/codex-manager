const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('codexManager', {
  openSignIn: (url, mode = 'browser') => ipcRenderer.invoke('login:open', url, mode),
  closeSignIn: () => ipcRenderer.invoke('login:close'),
});
