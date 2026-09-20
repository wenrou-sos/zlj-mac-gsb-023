/** 领域元数据与格式化工具（前后端语义保持一致，供组件与测试共用） */

export const POLLUTANT_META = {
  dust: { name: '粉尘', unit: 'mg/m³', color: '#8c6d4f' },
  nox: { name: '氮氧化物', unit: 'mg/m³', color: '#5b8def' },
  so2: { name: '二氧化硫', unit: 'mg/m³', color: '#e6a23c' },
};

export const SEVERITY_META = {
  warning: { label: '一般', color: '#e6a23c' },
  major: { label: '较重', color: '#f56c6c' },
  critical: { label: '严重', color: '#c0392b' },
};

export const EVENT_STATUS_META = {
  pending: { label: '待处置', color: '#f56c6c' },
  processing: { label: '处置中', color: '#e6a23c' },
  resolved: { label: '已办结', color: '#67c23a' },
};

export const EQUIPMENT_STATUS_META = {
  running: { label: '运行', color: '#67c23a' },
  maintenance: { label: '检修', color: '#e6a23c' },
  offline: { label: '停运', color: '#909399' },
  fault: { label: '故障', color: '#f56c6c' },
};

export const HANDLE_ACTIONS = [
  { action: 'claim', label: '认领', from: ['pending'] },
  { action: 'investigate', label: '原因排查', from: ['processing'] },
  { action: 'measure', label: '采取措施', from: ['processing'] },
  { action: 'resolve', label: '办结', from: ['processing'] },
];

/** 当前状态下可执行的处置动作 */
export function availableActions(status) {
  return HANDLE_ACTIONS.filter((a) => a.from.includes(status));
}

/** 超标率：value 超出 limit 的百分比，未超标返回 <= 0 */
export function exceedRate(value, limit) {
  if (!limit || limit <= 0) return 0;
  return +(((value - limit) / limit) * 100).toFixed(1);
}

/** 告警组合并摘要，如 "5 条告警 · 峰值 420 mg/m³" */
export function groupMergeSummary(group, unit = 'mg/m³') {
  if (!group) return '';
  return `${group.alarm_count} 条告警合并 · 峰值 ${group.max_value} ${unit}`;
}

export function formatTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
