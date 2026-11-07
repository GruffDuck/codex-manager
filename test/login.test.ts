import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startLogin, loginStatus, cancelLogin } from '../core/src/login.js';
async function port() {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return value;
}
test('successful sign-in reports its own completion even when the account already exists', async () => {
  const session = await startLogin({ onCode: async () => ({ label: 'existing@example.test' }) }, { port: await port() });
  try {
    assert.equal(loginStatus(session.id)?.status, 'pending');
    const callback = new URL(session.redirect_uri);
    callback.searchParams.set('code', 'test-code');callback.searchParams.set('state', session.state);
    const response = await fetch(callback);
    assert.equal(response.status, 200);
    assert.deepEqual(loginStatus(session.id), { status: 'completed', label: 'existing@example.test' });
    assert.match(await response.text(), /Account added/);
    cancelLogin();
    assert.equal(loginStatus(session.id)?.status, 'completed');
  } finally { cancelLogin(); }
});
test('failed code exchange reports an error instead of pending forever', async () => {
  const session = await startLogin({ onCode: async () => { throw new Error('Exchange failed'); } }, { port: await port() });
  try {
    const callback = new URL(session.redirect_uri);callback.searchParams.set('code', 'test');callback.searchParams.set('state', session.state);
    assert.equal((await fetch(callback)).status, 500);
    assert.deepEqual(loginStatus(session.id), { status: 'failed', message: 'Exchange failed' });
  } finally { cancelLogin(); }
});
test('foreign state cannot fail a pending login and cancellation is observable', async () => {
  const session = await startLogin({ onCode: async () => ({ label: 'test' }) }, { port: await port() });
  try {
    const callback = new URL(session.redirect_uri);callback.searchParams.set('error', 'access_denied');callback.searchParams.set('state', 'foreign');
    assert.equal((await fetch(callback)).status, 400);
    assert.equal(loginStatus(session.id)?.status, 'pending');
    cancelLogin();
    assert.equal(loginStatus(session.id)?.status, 'cancelled');
    assert.equal(loginStatus('unknown'), null);
  } finally { cancelLogin(); }
});
