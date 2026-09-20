import axios from 'axios';

const api = axios.create({ baseURL: '/api', timeout: 10000 });

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const message = err.response?.data?.error || err.message || '请求失败';
    return Promise.reject(new Error(message));
  }
);

export const getOverview = () => api.get('/overview');
export const getPoints = () => api.get('/monitoring-points');
export const getEmissions = (params) => api.get('/emissions', { params });
export const getAlarmGroups = (params) => api.get('/alarms/groups', { params });
export const getAlarmGroupDetail = (id) => api.get(`/alarms/groups/${id}`);
export const closeAlarmGroup = (id) => api.post(`/alarms/groups/${id}/close`);
export const getEvents = (params) => api.get('/events', { params });
export const getEventDetail = (id) => api.get(`/events/${id}`);
export const handleEvent = (id, payload) => api.post(`/events/${id}/handle`, payload);
export const getEquipment = () => api.get('/equipment');
export const updateEquipmentStatus = (id, status) => api.put(`/equipment/${id}/status`, { status });

export default api;
