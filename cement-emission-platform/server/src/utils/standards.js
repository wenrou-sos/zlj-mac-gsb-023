'use strict';

/**
 * 水泥工业大气污染物排放标准（GB 4915-2013，重点地区特别排放限值）
 * 单位：mg/m³
 */
const POLLUTANTS = {
  dust: { code: 'dust', name: '粉尘', limit: 20, unit: 'mg/m³' },
  nox: { code: 'nox', name: '氮氧化物', limit: 320, unit: 'mg/m³' },
  so2: { code: 'so2', name: '二氧化硫', limit: 100, unit: 'mg/m³' },
};

const EQUIPMENT_STATUS = ['running', 'maintenance', 'offline', 'fault'];
// 设备处于这些状态时，告警标记为免考核（不计入超标事件）
const EXEMPT_EQUIPMENT_STATUS = ['maintenance', 'offline'];

const EVENT_STATUS = ['pending', 'processing', 'resolved'];

module.exports = { POLLUTANTS, EQUIPMENT_STATUS, EXEMPT_EQUIPMENT_STATUS, EVENT_STATUS };
