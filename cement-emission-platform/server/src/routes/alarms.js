'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

/** GET /api/alarms/groups 合并后的告警组列表 */
router.get('/groups', async (req, res, next) => {
  try {
    const { status, pollutant, pointId } = req.query;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const size = Math.min(Number(req.query.size) || 20, 100);
    const conds = [];
    const params = [];
    if (status) { params.push(status); conds.push(`g.status = $${params.length}`); }
    if (pollutant) { params.push(pollutant); conds.push(`g.pollutant = $${params.length}`); }
    if (pointId) { params.push(Number(pointId)); conds.push(`g.monitoring_point_id = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const total = await db.query(`SELECT count(*)::int AS c FROM alarm_groups g ${where}`, params);
    params.push(size, (page - 1) * size);
    const { rows } = await db.query(
      `SELECT g.*, p.name AS point_name, p.code AS point_code,
              e.id AS event_id, e.status AS event_status
         FROM alarm_groups g
         JOIN monitoring_points p ON p.id = g.monitoring_point_id
         LEFT JOIN exceedance_events e ON e.alarm_group_id = g.id
         ${where}
        ORDER BY g.last_alarm_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ data: rows, total: total.rows[0].c, page, size });
  } catch (err) { next(err); }
});

/** GET /api/alarms/groups/:id 告警组详情（含组内每条原始告警） */
router.get('/groups/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT g.*, p.name AS point_name FROM alarm_groups g
        JOIN monitoring_points p ON p.id = g.monitoring_point_id
       WHERE g.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: '告警组不存在' });
    const alarms = await db.query(
      'SELECT * FROM alarms WHERE group_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json({ group: rows[0], alarms: alarms.rows });
  } catch (err) { next(err); }
});

/** POST /api/alarms/groups/:id/close 人工关闭告警组 */
router.post('/groups/:id/close', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `UPDATE alarm_groups SET status = 'closed' WHERE id = $1 AND status = 'active' RETURNING *`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: '告警组不存在或已关闭' });
    res.json({ group: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
