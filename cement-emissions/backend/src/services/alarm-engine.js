/**
 * 告警判定与合并引擎（纯函数，便于单元测试）。
 *
 * 合并规则：同一设备 + 同一污染物，在合并时间窗口（默认 10 分钟）内
 * 重复发生的超标告警归入同一个告警组；超窗口或原组已关闭则新开组。
 */

/**
 * 根据限值判定读数等级
 * @param {number} value
 * @param {{warning:number, critical:number}} threshold
 * @returns {'ok'|'warning'|'critical'}
 */
export function evaluateLevel(value, threshold) {
  if (!threshold) return 'ok';
  if (value >= Number(threshold.critical)) return 'critical';
  if (value >= Number(threshold.warning)) return 'warning';
  return 'ok';
}

/**
 * 设备在停机/检修状态下产生的告警应被抑制（避免无效告警）
 */
export function isSuppressedByEquipment(equipmentStatus) {
  return equipmentStatus === 'stopped' || equipmentStatus === 'maintenance';
}

/**
 * 判断一条新告警应合并入已有告警组还是新开组
 * @param {{status:string, last_alarm_at:Date|string}|null} group 最近告警组
 * @param {Date|string} measuredAt 读数时间
 * @param {number} windowMs 合并窗口
 */
export function shouldMerge(group, measuredAt, windowMs) {
  if (!group) return false;
  if (group.status !== 'active' && group.status !== 'acknowledged') {
    return false;
  }
  const last = new Date(group.last_alarm_at).getTime();
  const now = new Date(measuredAt).getTime();
  return now - last <= windowMs;
}

/**
 * 计算合并后的告警组聚合字段
 */
export function mergeIntoGroup(group, value, level, measuredAt) {
  const at = new Date(measuredAt);
  return {
    ...group,
    peak_value: Math.max(Number(group.peak_value), Number(value)),
    latest_value: Number(value),
    last_alarm_at: at,
    alarm_count: Number(group.alarm_count) + 1,
    // 严重程度只升不降
    severity: group.severity === 'critical' || level === 'critical'
      ? 'critical'
      : 'warning',
  };
}

/**
 * 读数恢复正常时，满足以下条件可自动消解告警组：
 * 最近组仍处于 active/acknowledged，且恢复读数产生时间晚于组内最后告警。
 */
export function shouldAutoResolve(group, measuredAt) {
  if (!group) return false;
  if (group.status !== 'active' && group.status !== 'acknowledged') {
    return false;
  }
  return new Date(measuredAt).getTime() >=
    new Date(group.last_alarm_at).getTime();
}

/**
 * 事件升级严重度（只升不降）
 */
export function escalateSeverity(current, incoming) {
  if (current === 'critical' || incoming === 'critical') return 'critical';
  return 'warning';
}
