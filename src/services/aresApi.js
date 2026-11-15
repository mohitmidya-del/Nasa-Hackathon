const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function getAuthHeader() {
  try {
    const token = localStorage.getItem('ares_auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...getAuthHeader(),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      let parsedDetail = detail;
      try {
        const jsonDetail = JSON.parse(detail);
        if (jsonDetail.detail) parsedDetail = jsonDetail.detail;
      } catch {}
      const err = new Error(parsedDetail || `ARES API error ${res.status}`);
      err.status = res.status;
      err.detail = parsedDetail;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function quiet(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function getHealth() {
  return quiet(() => request('/api/health'));
}

export async function createMission(data) {
  return quiet(() => request('/api/missions', { method: 'POST', body: data }));
}

export async function analyzeMission(data) {
  return quiet(() => request('/api/navigation/analyze', { method: 'POST', body: data }));
}

export async function compareRoutes(data) {
  return quiet(() => request('/api/navigation/compare', { method: 'POST', body: data }));
}

export async function reportHazard(data) {
  return quiet(() => request('/api/navigation/hazard', { method: 'POST', body: data }));
}

export async function updateTelemetry(data) {
  return quiet(() => request('/api/telemetry/update', { method: 'POST', body: data }));
}

/* ---------------- PostgreSQL User Auth & Route/Hazard History ---------------- */

export async function authRegister(username, email, password, callsign) {
  return request('/api/auth/register', {
    method: 'POST',
    body: { username, email, password, callsign: callsign || 'ARES-CREW-1' },
  });
}

export async function authLogin(username, password) {
  return request('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
}

export async function authLogout() {
  return quiet(() => request('/api/auth/logout', { method: 'POST' }));
}

export async function authGetMe() {
  return quiet(() => request('/api/auth/me'));
}

export async function authGetTraverses(params = {}) {
  const q = new URLSearchParams();
  if (params.mission_id) q.set('mission_id', params.mission_id);
  if (params.route_mode) q.set('route_mode', params.route_mode);
  const queryStr = q.toString() ? `?${q.toString()}` : '';
  return quiet(() => request(`/api/auth/traverses${queryStr}`));
}

export async function authSaveTraverse(traverseData) {
  return quiet(() => request('/api/auth/traverses', { method: 'POST', body: traverseData }));
}
