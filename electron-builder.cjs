const path = require('node:path');
const targetPlatform = process.env.CODEX_MANAGER_BUILD_PLATFORM || process.platform;
const targetArch = process.env.CODEX_MANAGER_BUILD_ARCH || process.arch;
module.exports = {
  appId: 'local.codex-manager',
  productName: 'Codex Manager',
  asar: false,
  directories: { output: 'release' },
  files: ['electron/**', 'core/dist/**', 'ui/dist/**', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/**', ...(targetPlatform === 'win32' ? ['!electron/native/**'] : [])],
  extraResources: [{ from: path.join('.runtime', `${targetPlatform}-${targetArch}`), to: 'runtime', filter: ['node', 'node.exe', 'NODE-LICENSE', 'manifest.json'] }],
  npmRebuild: false,
  toolsets: { nsis: '1.2.1' },
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  mac: { category: 'public.app-category.developer-tools', icon: 'electron/assets/icon.icns', target: ['dmg', 'zip'], identity: null },
  dmg: { title: 'Codex Manager', contents: [{ x: 140, y: 160 }, { x: 420, y: 160, type: 'link', path: '/Applications' }] },
  win: { target: ['nsis', 'zip'], icon: 'electron/assets/icon.png', signAndEditExecutable: false,
    artifactName: '${productName}-${version}-win-${arch}.${ext}' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, deleteAppDataOnUninstall: false, runAfterFinish: false,
    artifactName: '${productName}-Setup-${version}-win-${arch}.${ext}' },
  linux: { category: 'Development', icon: 'electron/assets/icon.png', target: ['AppImage', 'tar.gz'] },
};
