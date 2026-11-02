import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
if (process.platform === 'darwin') {
  fs.mkdirSync('electron/native/bin', { recursive: true });
  execFileSync('/usr/bin/xcrun', ['swiftc', '-O', '-module-cache-path', '/tmp/codex-manager-swift-cache',
    'electron/native/CodexLifecycle.swift', '-o', 'electron/native/bin/codex-lifecycle'], { stdio: 'inherit' });
  console.log('Built macOS Codex lifecycle helper');
} else console.log('Automatic Codex restart currently supports macOS only.');
