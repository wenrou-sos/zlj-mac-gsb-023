export const POLLUTANTS = [
  { key: 'dust', label: '粉尘', unit: 'mg/Nm³', color: '#d97706' },
  { key: 'nox', label: '氮氧化物', unit: 'mg/Nm³', color: '#7c3aed' },
  { key: 'so2', label: '二氧化硫', unit: 'mg/Nm³', color: '#dc2626' },
];

export const POLLUTANT_MAP = Object.fromEntries(POLLUTANTS.map((p) => [p.key, p]));

export const EQUIPMENT_STATUS = {
  running: { label: '运行中', color: '#16a34a', bg: '#dcfce7' },
  maintenance: { label: '检修中', color: '#2563eb', bg: '#dbeafe' },
  stopped: { label: '停机', color: '#6b7280', bg: '#f3f4f6' },
  fault: { label: '故障', color: '#dc2626', bg: '#fee2e2' },
};

export const ALARM_STATUS = {
  active: { label: '未确认', color: '#dc2626', bg: '#fee2e2' },
  acknowledged: { label: '已确认', color: '#d97706', bg: '#fef3c7' },
  resolved: { label: '已消解', color: '#16a34a', bg: '#dcfce7' },
  suppressed: { label: '已抑制', color: '#6b7280', bg: '#f3f4f6' },
};

export const SEVERITY = {
  warning: { label: '预警', color: '#d97706', bg: '#fef3c7' },
  critical: { label: '严重', color: '#dc2626', bg: '#fee2e2' },
};

export const EVENT_STATUS = {
  open: { label: '待派单', color: '#dc2626', bg: '#fee2e2' },
  dispatched: { label: '已派单', color: '#d97706', bg: '#fef3c7' },
  handling: { label: '处置中', color: '#2563eb', bg: '#dbeafe' },
  resolved: { label: '已处置', color: '#16a34a', bg: '#dcfce7' },
  closed: { label: '已归档', color: '#6b7280', bg: '#f3f4f6' },
};

// 状态机允许的下一步操作（与后端 event-machine 保持一致）
export const EVENT_NEXT_ACTIONS = {
  open: [
    { to: 'dispatched', label: '派单', needNote: false },
    { to: 'handling', label: '直接处置', needNote: false },
    { to: 'closed', label: '关闭', needNote: false },
  ],
  dispatched: [
    { to: 'handling', label: '开始处置', needNote: false },
    { to: 'open', label: '退回派单', needNote: false },
  ],
  handling: [
    { to: 'resolved', label: '处置完成', needNote: true, needResolution: true },
  ],
  resolved: [
    { to: 'closed', label: '归档关闭', needNote: false },
    { to: 'handling', label: '退回继续处置', needNote: false },
  ],
  closed: [],
};
