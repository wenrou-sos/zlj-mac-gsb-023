import { query, withTransaction } from '../db/pool.js';

/* ---------- 设备 ---------- */

export const listEquipment = () =>
  query(`SELECT * FROM equipment ORDER BY id`).then((r) => r.rows);

export const getEquipment = (id) =>
  query(`SELECT * FROM equipment WHERE id = $1`, [id]).then((r) => r.rows[0]);

export const getEquipmentByCode = (code) =>
  query(`SELECT * FROM equipment WHERE code = $1`, [code]).then(
    (r) => r.rows[0],
  );

export const insertEquipment = ({ code, name, location, status }) =>
  query(
    `INSERT INTO equipment (code, name, location, status)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [code, name, location || null, status || 'running'],
  ).then((r) => r.rows[0]);

export const updateEquipmentStatus = (id, status) =>
  query(
    `UPDATE equipment SET status = $2 WHERE id = $1 RETURNING *`,
    [id, status],
  ).then((r) => r.rows[0]);

/* ---------- 限值 ---------- */

export const listThresholds = () =>
  query(
    `SELECT t.*, e.code AS equipment_code
       FROM thresholds t LEFT JOIN equipment e ON e.id = t.equipment_id
      ORDER BY t.equipment_id NULLS FIRST, t.pollutant`,
  ).then((r) => r.rows);

export const getThreshold = async (equipmentId, pollutant) => {
  // 优先设备专属限值，缺省回落全局限值
  const res = await query(
    `SELECT * FROM thresholds
      WHERE pollutant = $1
        AND (equipment_id = $2 OR equipment_id IS NULL)
      ORDER BY equipment_id NULLS LAST
      LIMIT 1`,
    [pollutant, equipmentId],
  );
  return res.rows[0];
};

export const upsertThreshold = ({ equipmentId, pollutant, warning, critical }) =>
  query(
    `INSERT INTO thresholds (equipment_id, pollutant, warning, critical, updated_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (equipment_id, pollutant)
     DO UPDATE SET warning = EXCLUDED.warning,
                   critical = EXCLUDED.critical,
                   updated_at = now()
     RETURNING *`,
    [equipmentId, pollutant, warning, critical],
  ).then((r) => r.rows[0]);

/* ---------- 读数 ---------- */

export const insertReading = (client, { equipmentId, pollutant, value, measuredAt }) =>
  client.query(
    `INSERT INTO readings (equipment_id, pollutant, value, measured_at)
     VALUES ($1,$2,$3, COALESCE($4, now())) RETURNING *`,
    [equipmentId, pollutant, value, measuredAt || null],
  ).then((r) => r.rows[0]);

export const latestReadings = () =>
  query(
    `SELECT DISTINCT ON (equipment_id, pollutant) *
       FROM readings ORDER BY equipment_id, pollutant, measured_at DESC`,
  ).then((r) => r.rows);

export const readingSeries = async ({ equipmentId, pollutant, hours = 6, aggregate }) => {
  if (aggregate) {
    const interval =
      aggregate === 'hour' ? '1 hour' :
      aggregate === 'minute' ? '1 minute' : '5 minutes';
    return query(
      `SELECT date_trunc($2, measured_at) AS bucket,
              AVG(value)::numeric(12,2) AS avg_value,
              MAX(value)::numeric(12,2) AS max_value,
              MIN(value)::numeric(12,2) AS min_value
         FROM readings
        WHERE equipment_id = $1 AND pollutant = $3
          AND measured_at >= now() - ($4 || ' hours')::interval
        GROUP BY bucket ORDER BY bucket`,
      [equipmentId, interval, pollutant, String(hours)],
    ).then((r) => r.rows);
  }
  return query(
    `SELECT id, value, measured_at FROM readings
      WHERE equipment_id = $1 AND pollutant = $2
        AND measured_at >= now() - ($3 || ' hours')::interval
      ORDER BY measured_at ASC
      LIMIT 5000`,
    [equipmentId, pollutant, String(hours)],
  ).then((r) => r.rows);
};

/* ---------- 告警组 ---------- */

export const findOpenGroup = (client, equipmentId, pollutant) =>
  client
    .query(
      `SELECT * FROM alarm_groups
        WHERE equipment_id = $1 AND pollutant = $2
          AND status IN ('active','acknowledged')
        ORDER BY last_alarm_at DESC LIMIT 1`,
      [equipmentId, pollutant],
    )
    .then((r) => r.rows[0]);

export const createSuppressedGroup = (client, data) =>
  client
    .query(
      `INSERT INTO alarm_groups
        (equipment_id, pollutant, status, severity, peak_value, latest_value,
         first_alarm_at, last_alarm_at, alarm_count, suppression_reason)
       VALUES ($1,$2,'suppressed',$3,$4,$4,$5,$5,1,$6) RETURNING *`,
      [
        data.equipmentId,
        data.pollutant,
        data.level,
        data.value,
        data.measuredAt,
        data.reason,
      ],
    )
    .then((r) => r.rows[0]);

export const updateGroupMerged = (client, group) =>
  client
    .query(
      `UPDATE alarm_groups
         SET peak_value = $2, latest_value = $3, last_alarm_at = $4,
             alarm_count = $5, severity = $6
       WHERE id = $1 RETURNING *`,
      [
        group.id,
        group.peak_value,
        group.latest_value,
        group.last_alarm_at,
        group.alarm_count,
        group.severity,
      ],
    )
    .then((r) => r.rows[0]);

export const insertAlarm = (client, { groupId, equipmentId, pollutant, value, limitValue, level, readingId }) =>
  client
    .query(
      `INSERT INTO alarms (group_id, equipment_id, pollutant, value, limit_value, level, reading_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [groupId, equipmentId, pollutant, value, limitValue, level, readingId],
    )
    .then((r) => r.rows[0]);

export const resolveGroup = (client, groupId) =>
  client
    .query(
      `UPDATE alarm_groups SET status = 'resolved' WHERE id = $1 RETURNING *`,
      [groupId],
    )
    .then((r) => r.rows[0]);

export const bindEventToGroup = (client, groupId, eventId) =>
  client.query(`UPDATE alarm_groups SET event_id = $2 WHERE id = $1`, [
    groupId,
    eventId,
  ]);

export const listAlarmGroups = ({ status, equipmentId, limit = 100 }) => {
  const conds = [];
  const params = [];
  if (status) {
    params.push(status);
    conds.push(`g.status = $${params.length}`);
  }
  if (equipmentId) {
    params.push(equipmentId);
    conds.push(`g.equipment_id = $${params.length}`);
  }
  params.push(limit);
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return query(
    `SELECT g.*, e.name AS equipment_name, e.code AS equipment_code,
            e.status AS equipment_status,
            ev.status AS event_status
       FROM alarm_groups g
       JOIN equipment e ON e.id = g.equipment_id
       LEFT JOIN events ev ON ev.id = g.event_id
       ${where}
      ORDER BY g.last_alarm_at DESC
      LIMIT $${params.length}`,
    params,
  ).then((r) => r.rows);
};

export const getAlarmGroup = (id) =>
  query(
    `SELECT g.*, e.name AS equipment_name, e.code AS equipment_code,
            e.status AS equipment_status
       FROM alarm_groups g JOIN equipment e ON e.id = g.equipment_id
      WHERE g.id = $1`,
    [id],
  ).then((r) => r.rows[0]);

export const listAlarmsByGroup = (groupId) =>
  query(
    `SELECT * FROM alarms WHERE group_id = $1 ORDER BY created_at DESC LIMIT 500`,
    [groupId],
  ).then((r) => r.rows);

export const acknowledgeGroup = (id, actor) =>
  query(
    `UPDATE alarm_groups SET status = 'acknowledged'
      WHERE id = $1 AND status = 'active' RETURNING *`,
    [id],
  ).then((r) => r.rows[0]);

/* ---------- 事件 ---------- */

export const createEvent = (client, { groupId, equipmentId, pollutant, severity, peakValue }) =>
  client
    .query(
      `INSERT INTO events (alarm_group_id, equipment_id, pollutant, severity, peak_value)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [groupId, equipmentId, pollutant, severity, peakValue],
    )
    .then((r) => r.rows[0]);

export const addAction = (client, { eventId, action, fromStatus, toStatus, actor, note }) =>
  client.query(
    `INSERT INTO event_actions (event_id, action, from_status, to_status, actor, note)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      eventId,
      action,
      fromStatus || null,
      toStatus || null,
      actor || null,
      note || null,
    ],
  );

export const listEvents = ({ status, equipmentId, limit = 100 }) => {
  const conds = [];
  const params = [];
  if (status) {
    params.push(status);
    conds.push(`ev.status = $${params.length}`);
  }
  if (equipmentId) {
    params.push(equipmentId);
    conds.push(`ev.equipment_id = $${params.length}`);
  }
  params.push(limit);
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return query(
    `SELECT ev.*, e.name AS equipment_name, e.code AS equipment_code,
            e.status AS equipment_status
       FROM events ev JOIN equipment e ON e.id = ev.equipment_id
       ${where}
      ORDER BY ev.started_at DESC LIMIT $${params.length}`,
    params,
  ).then((r) => r.rows);
};

export const getEvent = (id) =>
  query(
    `SELECT ev.*, e.name AS equipment_name, e.code AS equipment_code,
            e.status AS equipment_status
       FROM events ev JOIN equipment e ON e.id = ev.equipment_id
      WHERE ev.id = $1`,
    [id],
  ).then((r) => r.rows[0]);

export const listEventActions = (id) =>
  query(
    `SELECT * FROM event_actions WHERE event_id = $1 ORDER BY created_at ASC`,
    [id],
  ).then((r) => r.rows);

export const updateEvent = (client, id, fields) => {
  const sets = [];
  const params = [id];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  if (!sets.length) return getEvent(id);
  return client
    .query(
      `UPDATE events SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    )
    .then((r) => r.rows[0]);
};

export { query, withTransaction };
