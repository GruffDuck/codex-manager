// Native documentation preview of the production UI. Uses only a read-only demo server.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');
app.setName('Codex Manager Preview');
app.setPath('userData', path.join(os.tmpdir(), 'codex-manager-docs-preview'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1360, height: 980, minWidth: 900, minHeight: 620,
    title: 'Codex Manager', backgroundColor: '#ffffff',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await window.loadURL('http://127.0.0.1:18065/#/accounts');
  // Matches the production shell's Electron layout marker.
  await window.webContents.executeJavaScript("document.documentElement.dataset.electron = 'true'");
});
app.on('window-all-closed', () => app.quit());
