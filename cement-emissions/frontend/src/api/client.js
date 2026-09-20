const BASE = import.meta.env.VITE_API_BASE || '';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || `请求失败 (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  getOverview: () => request('/api/overview'),
  getEquipment: () => request('/api/equipment'),
  setEquipmentStatus: (id, status) =>
    request(`/api/equipment/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  getThresholds: () => request('/api/thresholds'),
  saveThreshold: (payload) =>
    request('/api/thresholds', { method: 'PUT', body: JSON.stringify(payload) }),

  getReadings: (params) => {
    const qs = new URLSearchParams(Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)]));
    return request(`/api/readings?${qs}`);
  },
  getLatestReadings: () => request('/api/readings/latest'),
  postReading: (payload) =>
    request('/api/readings', { method: 'POST', body: JSON.stringify(payload) }),

  getAlarms: (params = {}) => {
    const qs = new URLSearchParams(params);
    return request(`/api/alarms?${qs}`);
  },
  getAlarm: (id) => request(`/api/alarms/${id}`),
  acknowledgeAlarm: (id, actor = '值班员') =>
    request(`/api/alarms/${id}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify({ actor }),
    }),

  getEvents: (params = {}) => {
    const qs = new URLSearchParams(params);
    return request(`/api/events?${qs}`);
  },
  getEvent: (id) => request(`/api/events/${id}`),
  transitionEvent: (id, payload) =>
    request(`/api/events/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  assignEvent: (id, payload) =>
    request(`/api/events/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  commentEvent: (id, payload) =>
    request(`/api/events/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
