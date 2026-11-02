import { spawnSync } from 'node:child_process';
const arch = process.argv[2] || 'x64';
if (!['x64', 'arm64'].includes(arch)) throw new Error('Windows architecture must be x64 or arm64');
const env = { ...process.env, CODEX_MANAGER_BUILD_PLATFORM: 'win32', CODEX_MANAGER_BUILD_ARCH: arch, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
function run(binary, args) {
  const result = spawnSync(binary, args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'core/tsconfig.json']);
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'ui/vite.config.ts']);
run(process.execPath, ['scripts/prepare-runtime.mjs', 'win32', arch]);
run(process.execPath, ['node_modules/electron-builder/cli.js', '--config', 'electron-builder.cjs', '--win', `--${arch}`, '--publish', 'never']);
