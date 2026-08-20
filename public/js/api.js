// Fetch wrapper. The server answers errors with an i18n *key* ('err.…'),
// which is resolved into the user's language right here — so every caller
// can just toast(err.message).
import { t } from './i18n.js';

const jsonHeaders = { 'Content-Type': 'application/json' };

async function request(method, url, body) {
  const init = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers = jsonHeaders;
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data = null;
  // Only our own JSON errors carry a key meant for a toast. Anything else —
  // a reverse proxy's 502 page, say — is HTML, and a screenful of markup in
  // a toast is not an error message.
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const key = data?.error || 'err.unexpected';
    const err = new Error(t(key));
    err.key = key;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: u => request('GET', u),
  post: (u, b) => request('POST', u, b === undefined ? {} : b),
  put: (u, b) => request('PUT', u, b),
  del: u => request('DELETE', u),
};
