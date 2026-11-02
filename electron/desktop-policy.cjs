// Keep OS URL handling separate from untrusted renderer input.
function signInUrl(value) {
  if (typeof value !== 'string') throw new Error('Invalid sign-in URL.');
  const url = new URL(value);
  if (url.origin !== 'https://auth.openai.com' || url.pathname !== '/oauth/authorize' || url.username || url.password) {
    throw new Error('Only the ChatGPT sign-in page can be opened.');
  }
  const redirect = new URL(url.searchParams.get('redirect_uri'));
  if (redirect.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(redirect.hostname) || redirect.pathname !== '/auth/callback' || redirect.username || redirect.password) {
    throw new Error('Sign-in must return to the local callback.');
  }
  return url;
}
function webUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
async function startDesktop({ showLoading, startCore, loadApp, startBackground }) {
  await showLoading();
  await startCore();
  await loadApp();
  // Quota, tray and notification requests never gate the main window.
  startBackground();
}
module.exports = { signInUrl, webUrl, startDesktop };
