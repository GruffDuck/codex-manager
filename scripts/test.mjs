import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = fs.readdirSync('test').filter((name) => name.endsWith('.test.ts')).sort().map((name) => `test/${name}`);
const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', '--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
