import fs from 'node:fs';
import path from 'node:path';
import { codexConfigPath } from './paths.js';

/**
 * Two managed regions are needed because TOML root keys must appear before the
 * first table header: root keys go on top, the provider table goes at the end.
 * Anything the user had at root level is preserved as a comment and restored.
 */
const ROOT_START = '# >>> codex-manager (root keys: managed)';
const ROOT_END = '# <<< codex-manager (root keys)';
const PROVIDER_START = '# >>> codex-manager (provider: managed)';
const PROVIDER_END = '# <<< codex-manager (provider)';
const REMOVED_PREFIX = '# codex-manager-removed:';

const PROVIDER = 'codex_manager';
const DEFAULT_MODEL = 'gpt-5.1-codex';

function stripRegion(text: string, start: string, end: string): string {
  const out: string[] = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (line.trim() === start) {
      inside = true;
      continue;
    }
    if (inside && line.trim() === end) {
      inside = false;
      continue;
    }
    if (!inside) out.push(line);
  }
  return out.join('\n');
}

function stripManaged(text: string): string {
  let next = stripRegion(text, ROOT_START, ROOT_END);
  next = stripRegion(next, PROVIDER_START, PROVIDER_END);
  return next;
}

function inManagedRegion(text: string): boolean {
  return text.includes(ROOT_START) && text.includes(PROVIDER_START);
}

/** Root-level keys cannot follow a table header, so duplicates of these must go. */
function stripRootDuplicate(text: string, key: string): { text: string; removed: string[] } {
  const lines = text.split('\n');
  const out: string[] = [];
  const removed: string[] = [];
  let seenTable = false;
  for (const line of lines) {
    if (/^\s*\[/.test(line)) seenTable = true;
    if (!seenTable && new RegExp(`^\\s*${key}\\s*=`).test(line)) {
      removed.push(line.trim());
      continue;
    }
    out.push(line);
  }
  return { text: out.join('\n'), removed };
}

function rootStringValue(text: string, key: string): string | undefined {
  let seenTable = false;
  for (const line of text.split('\n')) {
    if (/^\s*\[/.test(line)) seenTable = true;
    if (seenTable) continue;
    const match = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`).exec(line);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

/** Removes `[model_providers.<name>]` until the next table header. */
function stripProviderTable(text: string, name: string): { text: string; removed: boolean } {
  const lines = text.split('\n');
  const out: string[] = [];
  let skipping = false;
  let removed = false;
  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      skipping = header[1]?.trim() === `model_providers.${name}`;
      if (skipping) {
        removed = true;
        continue;
      }
    }
    if (!skipping) out.push(line);
  }
  return { text: out.join('\n'), removed };
}

export interface ApplyResult {
  path: string;
  backup: string | null;
  warnings: string[];
  block: string;
}

export function applyCodexConfig(options: {
  port: number;
  apiKey: string;
  model?: string;
  provider?: string;
}): ApplyResult {
  const provider = options.provider?.trim() || PROVIDER;
  const file = codexConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const backupPath = `${file}.codex-manager.bak`;
  let backup: string | null = null;
  if (existing && !fs.existsSync(backupPath)) {
    fs.copyFileSync(file, backupPath);
    fs.chmodSync(backupPath, 0o600);
    backup = backupPath;
  }

  let body = stripManaged(existing);
  const warnings: string[] = [];
  const removedLines = existing.split('\n').flatMap((line) => {
    const match = new RegExp(`^${REMOVED_PREFIX}\\s?(.*)$`).exec(line.trim());
    return match?.[1] ? [match[1]] : [];
  });
  const inheritedModel = rootStringValue(existing, 'model');

  for (const key of ['model_provider', 'model']) {
    const cleaned = stripRootDuplicate(body, key);
    body = cleaned.text;
    if (cleaned.removed.length > 0) {
      removedLines.push(...cleaned.removed);
      warnings.push(
        key === 'model'
          ? 'Moved the existing root-level `model` into the managed block.'
          : 'Replaced an existing root-level `model_provider` (restored by “Remove block”).',
      );
    }
  }

  const table = stripProviderTable(body, provider);
  if (table.removed) {
    body = table.text;
    warnings.push(`Replaced an existing [model_providers.${provider}] table (backup kept).`);
  }

  const model = options.model?.trim() || inheritedModel || DEFAULT_MODEL;

  const rootBlock = [
    ROOT_START,
    `model_provider = ${JSON.stringify(provider)}`,
    `model = ${JSON.stringify(model)}`,
    ...removedLines.map((line) => `${REMOVED_PREFIX} ${line}`),
    ROOT_END,
    '',
  ].join('\n');

  const providerBlock = [
    '',
    PROVIDER_START,
    `[model_providers.${provider}]`,
    `name = "Codex Manager"`,
    `base_url = "http://127.0.0.1:${options.port}/v1"`,
    `wire_api = "responses"`,
    `requires_openai_auth = false`,
    `http_headers = { Authorization = "Bearer ${options.apiKey}" }`,
    PROVIDER_END,
    '',
  ].join('\n');

  const next = `${rootBlock}${body.replace(/^\n+/, '')}${providerBlock}`;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, next, { mode: 0o600 });
  fs.renameSync(tmp, file);

  return { path: file, backup, warnings, block: `${rootBlock}${providerBlock}` };
}

export function restoreCodexConfig(): { path: string; restored: boolean } {
  const file = codexConfigPath();
  if (!fs.existsSync(file)) return { path: file, restored: false };
  const existing = fs.readFileSync(file, 'utf8');

  const restoredKeys: string[] = [];
  for (const line of existing.split('\n')) {
    const match = new RegExp(`^${REMOVED_PREFIX}\\s?(.*)$`).exec(line.trim());
    if (match?.[1]) restoredKeys.push(match[1]);
  }

  const stripped = stripManaged(existing).replace(/^\n+/, '');
  const prefix = restoredKeys.length > 0 ? `${restoredKeys.join('\n')}\n\n` : '';
  const next = `${prefix}${stripped}`;
  const backupPath = `${file}.codex-manager.bak`;

  if (next.trim() === '' && fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, file);
    return { path: file, restored: true };
  }

  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, next, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return { path: file, restored: false };
}

export function codexConfigStatus(): { path: string; applied: boolean; backup: string | null } {
  const file = codexConfigPath();
  const backupPath = `${file}.codex-manager.bak`;
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  return {
    path: file,
    applied: inManagedRegion(text),
    backup: fs.existsSync(backupPath) ? backupPath : null,
  };
}
