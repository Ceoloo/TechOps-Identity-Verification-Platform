// Thin API client. Attaches the bearer token and normalises errors.

const TOKEN_KEY = 'techops_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(method, path, { body, auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (p, opts) => request('GET', p, opts),
  post: (p, body, opts) => request('POST', p, { ...opts, body }),
  put: (p, body, opts) => request('PUT', p, { ...opts, body }),
  patch: (p, body, opts) => request('PATCH', p, { ...opts, body }),
  del: (p, opts) => request('DELETE', p, opts),
};
