export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5432/cement_emissions',
  mergeWindowMs: Number(process.env.ALARM_MERGE_WINDOW_MS || 10 * 60 * 1000),
  seedOnStart: process.env.SEED_ON_START !== 'false',
  simulation: {
    enabled: process.env.SIMULATION_ENABLED === 'true',
    intervalMs: Number(process.env.SIMULATION_INTERVAL_MS || 5000),
  },
  poll: {
    enabled: process.env.POLL_SCHEDULE_ENABLED === 'true',
    intervalMs: Number(process.env.POLL_INTERVAL_MS || 15 * 60 * 1000),
  },
};

export const POLLUTANTS = ['dust', 'nox', 'so2'];

export const POLLUTANT_META = {
  dust: { label: '粉尘', unit: 'mg/Nm³', color: '#d97706' },
  nox: { label: '氮氧化物', unit: 'mg/Nm³', color: '#7c3aed' },
  so2: { label: '二氧化硫', unit: 'mg/Nm³', color: '#dc2626' },
};

export const EQUIPMENT_STATUS = ['running', 'maintenance', 'stopped', 'fault'];

export const EQUIPMENT_STATUS_META = {
  running: { label: '运行中', color: '#16a34a' },
  maintenance: { label: '检修中', color: '#2563eb' },
  stopped: { label: '停机', color: '#6b7280' },
  fault: { label: '故障', color: '#dc2626' },
};
