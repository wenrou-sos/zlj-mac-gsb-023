'use strict';

const express = require('express');
const db = require('../db');
const equipmentService = require('../services/equipmentService');

const router = express.Router();

/** GET /api/equipment 设备列表（含监测点与活动告警数） */
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT eq.*, p.name AS point_name, p.code AS point_code,
              (SELECT count(*)::int FROM alarm_groups g
                WHERE g.monitoring_point_id = eq.monitoring_point_id
                  AND g.status = 'active') AS active_alarm_groups
         FROM equipment eq
         LEFT JOIN monitoring_points p ON p.id = eq.monitoring_point_id
        ORDER BY eq.id`
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

/** PUT /api/equipment/:id/status 更新设备状态（联动告警免考核） */
router.put('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ error: 'status 为必填' });
    const result = await db.withTransaction((client) =>
      equipmentService.updateEquipmentStatus(client, Number(req.params.id), status)
    );
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
