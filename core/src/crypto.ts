import crypto from 'node:crypto';
import fs from 'node:fs';
import { KEY_PATH } from './paths.js';

let cachedKey: Buffer | null = null;

/** 32-byte key in a 0600 file. The database never stores plaintext tokens. */
function key(): Buffer {
  if (cachedKey) return cachedKey;
  if (fs.existsSync(KEY_PATH)) {
    const hex = fs.readFileSync(KEY_PATH, 'utf8').trim();
    const buf = Buffer.from(hex, 'hex');
    if (buf.length !== 32) throw new Error('secret.key is corrupt');
    cachedKey = buf;
    return buf;
  }
  const buf = crypto.randomBytes(32);
  fs.writeFileSync(KEY_PATH, `${buf.toString('hex')}\n`, { mode: 0o600 });
  cachedKey = buf;
  return buf;
}

export function seal(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function open<T>(sealed: string): T {
  const raw = Buffer.from(sealed, 'base64');
  if (raw.length < 29) throw new Error('sealed value is truncated');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

/** Constant-time bearer comparison so the gateway key cannot be probed byte by byte. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}
