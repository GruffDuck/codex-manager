import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '24.22.2';
const platform = process.argv[2] || process.platform;
const arch = process.argv[3] || process.arch;
if (!['darwin', 'linux', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch)) {
  throw new Error('Packaging supports macOS, Linux and Windows on arm64 / x64.');
}
const destination = path.join(root, '.runtime', `${platform}-${arch}`);
const releasePlatform = platform === 'win32' ? 'win' : platform;
const archive = `node-v${version}-${releasePlatform}-${arch}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
const binaryName = platform === 'win32' ? 'node.exe' : 'node';
const base = `https://nodejs.org/dist/v${version}`;
await fs.mkdir(destination, { recursive: true });
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Runtime download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const sums = (await download(`${base}/SHASUMS256.txt`)).toString('utf8');
const expected = sums.split('\n').find((line) => line.endsWith(`  ${archive}`))?.split(/\s+/)[0];
if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Official runtime checksum missing');
const cachedManifest = path.join(destination, 'manifest.json');
try {
  const manifest = JSON.parse(await fs.readFile(cachedManifest, 'utf8'));
  const binary = await fs.readFile(path.join(destination, binaryName));
  if (manifest.archive_sha256 === expected && crypto.createHash('sha256').update(binary).digest('hex') === manifest.binary_sha256) {
    console.log(`Verified cached Node ${version} (${platform}-${arch})`);
    process.exit(0);
  }
} catch { /* fetch a clean runtime */ }
const bytes = await download(`${base}/${archive}`);
if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Node runtime checksum mismatch');
const temporary = await fs.mkdtemp(path.join(root, '.runtime', 'extract-'));
try {
  const file = path.join(temporary, archive);
  await fs.writeFile(file, bytes);
  if (platform === 'win32' && process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Expand-Archive -LiteralPath $env:CODEX_MANAGER_RUNTIME_ARCHIVE -DestinationPath $env:CODEX_MANAGER_RUNTIME_EXTRACT'],
      { env: { ...process.env, CODEX_MANAGER_RUNTIME_ARCHIVE: file, CODEX_MANAGER_RUNTIME_EXTRACT: temporary } });
  } else if (platform === 'win32') {
    execFileSync('unzip', ['-q', file, '-d', temporary]);
  } else execFileSync('tar', ['-xzf', file, '-C', temporary]);
  const extracted = path.join(temporary, `node-v${version}-${releasePlatform}-${arch}`);
  await fs.copyFile(path.join(extracted, ...(platform === 'win32' ? ['node.exe'] : ['bin', 'node'])), path.join(destination, binaryName));
  await fs.chmod(path.join(destination, binaryName), 0o755);
  await fs.copyFile(path.join(extracted, 'LICENSE'), path.join(destination, 'NODE-LICENSE'));
  const binary = await fs.readFile(path.join(destination, binaryName));
  await fs.writeFile(cachedManifest, JSON.stringify({ version, platform, arch, source: `${base}/${archive}`, archive_sha256: expected,
    binary_sha256: crypto.createHash('sha256').update(binary).digest('hex') }, null, 2) + '\n');
  console.log(`Prepared verified Node ${version} (${platform}-${arch})`);
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
