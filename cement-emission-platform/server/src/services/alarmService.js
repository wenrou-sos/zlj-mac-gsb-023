'use strict';

const config = require('../config');
const { POLLUTANTS, EXEMPT_EQUIPMENT_STATUS } = require('../utils/standards');

/* ---------------- 纯函数（便于单元测试） ---------------- */

/** 按超标倍数计算告警级别：warning >=1x, major >=1.2x, critical >=1.5x */
function computeSeverity(value, limit) {
  const ratio = value / limit;
  if (ratio >= 1.5) return 'critical';
  if (ratio >= 1.2) return 'major';
  return 'warning';
}

const SEVERITY_RANK = { warning: 1, major: 2, critical: 3 };

/** 判断告警是否应并入指定告警组：同监测点、同污染物、组处于 active、距最后一条告警在合并窗口内 */
function shouldMerge(group, { monitoringPointId, pollutant, measuredAt }, windowMinutes) {
  if (!group || group.status !== 'active') return false;
  if (group.monitoring_point_id !== monitoringPointId) return false;
  if (group.pollutant !== pollutant) return false;
  const elapsedMs = new Date(measuredAt).getTime() - new Date(group.last_alarm_at).getTime();
  return elapsedMs <= windowMinutes * 60 * 1000;
}

/** 将一条新告警合并进告警组，返回更新后的组字段（不操作数据库） */
function mergeAlarmIntoGroup(group, alarm) {
  return {
    alarm_count: group.alarm_count + 1,
    max_value: Math.max(Number(group.max_value), Number(alarm.value)),
    severity: SEVERITY_RANK[alarm.severity] > SEVERITY_RANK[group.severity]
      ? alarm.severity
      : group.severity,
    last_alarm_at: alarm.created_at,
  };
}

/** 判断设备状态是否使告警免考核 */
function isExemptByEquipment(equipmentStatus) {
  return EXEMPT_EQUIPMENT_STATUS.includes(equipmentStatus);
}

/** 组内告警数达到阈值且非免考核时应生成超标事件 */
function shouldCreateEvent(group, thresholdCount) {
  return !group.exempt && group.alarm_count >= thresholdCount;
}

/* ---------------- 数据库操作 ---------------- */

/**
 * 处理一条排放数据：若超标则生成告警并执行合并，必要时触发超标事件。
 * 返回 { exceeded, alarm?, groupId?, eventId? }
 */
async function processEmissionData(client, data) {
  const meta = POLLUTANTS[data.pollutant];
  if (!meta) throw Object.assign(new Error(`未知污染物: ${data.pollutant}`), { status: 400 });

  const measuredAt = data.measured_at || new Date();
  const insert = await client.query(
    `INSERT INTO emission_data (monitoring_point_id, pollutant, value, unit, measured_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [data.monitoring_point_id, data.pollutant, data.value, meta.unit, measuredAt]
  );

  if (Number(data.value) <= meta.limit) {
    return { exceeded: false, emissionId: insert.rows[0].id };
  }

  // 关联设备状态快照（取该监测点下任一主要设备）
  const equip = await client.query(
    `SELECT status FROM equipment
      WHERE monitoring_point_id = $1
      ORDER BY id LIMIT 1`,
    [data.monitoring_point_id]
  );
  const equipmentStatus = equip.rows[0] ? equip.rows[0].status : 'running';
  const exempt = isExemptByEquipment(equipmentStatus);

  const severity = computeSeverity(data.value, meta.limit);
  const windowMinutes = config.alarm.mergeWindowMinutes;

  // 查找可合并的活动告警组
  const groups = await client.query(
    `SELECT * FROM alarm_groups
      WHERE monitoring_point_id = $1 AND pollutant = $2 AND status = 'active'
      ORDER BY last_alarm_at DESC`,
    [data.monitoring_point_id, data.pollutant]
  );

  let group = groups.rows.find((g) =>
    shouldMerge(g, {
      monitoringPointId: data.monitoring_point_id,
      pollutant: data.pollutant,
      measuredAt,
    }, windowMinutes)
  );

  if (!group) {
    const created = await client.query(
      `INSERT INTO alarm_groups
        (monitoring_point_id, pollutant, severity, alarm_count, max_value, limit_value,
         first_alarm_at, last_alarm_at, exempt, equipment_status)
       VALUES ($1,$2,$3,0,$4,$5,$6,$6,$7,$8) RETURNING *`,
      [data.monitoring_point_id, data.pollutant, severity, data.value, meta.limit,
        measuredAt, exempt, equipmentStatus]
    );
    group = created.rows[0];
  }

  const alarm = await client.query(
    `INSERT INTO alarms (group_id, monitoring_point_id, pollutant, value, limit_value, severity, message, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [group.id, data.monitoring_point_id, data.pollutant, data.value, meta.limit, severity,
      `${meta.name}浓度 ${data.value}${meta.unit} 超出限值 ${meta.limit}${meta.unit}`, measuredAt]
  );

  const merged = mergeAlarmIntoGroup(group, alarm.rows[0]);
  const updated = await client.query(
    `UPDATE alarm_groups
        SET alarm_count=$2, max_value=$3, severity=$4, last_alarm_at=$5
      WHERE id=$1 RETURNING *`,
    [group.id, merged.alarm_count, merged.max_value, merged.severity, merged.last_alarm_at]
  );

  // 达到阈值且未生成过事件时创建超标事件
  let eventId = null;
  if (shouldCreateEvent(updated.rows[0], config.alarm.eventThresholdCount)) {
    const existing = await client.query(
      'SELECT id FROM exceedance_events WHERE alarm_group_id = $1', [group.id]);
    if (existing.rows.length === 0) {
      const eventNo = `EV${Date.now()}${group.id}`;
      const ev = await client.query(
        `INSERT INTO exceedance_events
          (event_no, alarm_group_id, monitoring_point_id, pollutant, max_value, limit_value, started_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [eventNo, group.id, data.monitoring_point_id, data.pollutant,
          updated.rows[0].max_value, meta.limit, updated.rows[0].first_alarm_at]
      );
      eventId = ev.rows[0].id;
    }
  }

  return { exceeded: true, emissionId: insert.rows[0].id, alarm: alarm.rows[0], groupId: group.id, eventId };
}

/** 数据恢复正常后关闭活动告警组 */
async function closeRecoveredGroups(client, monitoringPointId, pollutant, recoveredAt) {
  const res = await client.query(
    `UPDATE alarm_groups SET status = 'closed'
      WHERE monitoring_point_id = $1 AND pollutant = $2 AND status = 'active'
        AND last_alarm_at < $3
      RETURNING id`,
    [monitoringPointId, pollutant, recoveredAt]
  );
  return res.rows.map((r) => r.id);
}

module.exports = {
  computeSeverity,
  shouldMerge,
  mergeAlarmIntoGroup,
  isExemptByEquipment,
  shouldCreateEvent,
  processEmissionData,
  closeRecoveredGroups,
  SEVERITY_RANK,
};
