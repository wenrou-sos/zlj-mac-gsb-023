'use strict';

const express = require('express');
const db = require('../db');
const eventService = require('../services/eventService');

const router = express.Router();

/** GET /api/events?status= 超标事件列表 */
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    const conds = [];
    const params = [];
    if (status) { params.push(status); conds.push(`e.status = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT e.*, p.name AS point_name
         FROM exceedance_events e
         JOIN monitoring_points p ON p.id = e.monitoring_point_id
         ${where}
        ORDER BY e.created_at DESC LIMIT 200`,
      params
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

/** GET /api/events/:id 事件详情：处置记录 + 关联告警组 + 设备状态 */
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT e.*, p.name AS point_name
         FROM exceedance_events e
         JOIN monitoring_points p ON p.id = e.monitoring_point_id
        WHERE e.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: '超标事件不存在' });
    const event = rows[0];

    const [records, group, equipment] = await Promise.all([
      db.query('SELECT * FROM handling_records WHERE event_id = $1 ORDER BY created_at', [event.id]),
      db.query('SELECT * FROM alarm_groups WHERE id = $1', [event.alarm_group_id]),
      db.query(
        `SELECT id, code, name, type, status, updated_at FROM equipment
          WHERE monitoring_point_id = $1 ORDER BY id`,
        [event.monitoring_point_id]
      ),
    ]);
    res.json({
      event,
      records: records.rows,
      alarmGroup: group.rows[0] || null,
      equipment: equipment.rows,
    });
  } catch (err) { next(err); }
});

/** POST /api/events/:id/handle 处置事件 { action, operator, note } */
router.post('/:id/handle', async (req, res, next) => {
  try {
    const { action, operator, note } = req.body || {};
    if (!action) return res.status(400).json({ error: 'action 为必填' });
    const event = await db.withTransaction((client) =>
      eventService.handleEvent(client, Number(req.params.id), { action, operator, note })
    );
    res.json({ event });
  } catch (err) { next(err); }
});

module.exports = router;
