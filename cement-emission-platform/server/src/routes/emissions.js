'use strict';

const express = require('express');
const db = require('../db');
const { POLLUTANTS } = require('../utils/standards');
const alarmService = require('../services/alarmService');

const router = express.Router();

/** GET /api/emissions?pointId=&pollutant=&from=&to=&limit= 查询排放时序数据 */
router.get('/', async (req, res, next) => {
  try {
    const { pointId, pollutant, from, to } = req.query;
    const limit = Math.min(Number(req.query.limit) || 200, 2000);
    const conds = [];
    const params = [];
    if (pointId) { params.push(Number(pointId)); conds.push(`monitoring_point_id = $${params.length}`); }
    if (pollutant) {
      if (!POLLUTANTS[pollutant]) return res.status(400).json({ error: '非法污染物类型' });
      params.push(pollutant); conds.push(`pollutant = $${params.length}`);
    }
    if (from) { params.push(new Date(from)); conds.push(`measured_at >= $${params.length}`); }
    if (to) { params.push(new Date(to)); conds.push(`measured_at <= $${params.length}`); }
    params.push(limit);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT id, monitoring_point_id, pollutant, value, unit, measured_at
         FROM emission_data ${where}
        ORDER BY measured_at DESC LIMIT $${params.length}`,
      params
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

/** POST /api/emissions 上报一条监测数据（触发告警判定与合并） */
router.post('/', async (req, res, next) => {
  try {
    const { monitoring_point_id: pointId, pollutant, value, measured_at: measuredAt } = req.body || {};
    if (!pointId || !pollutant || value === undefined) {
      return res.status(400).json({ error: 'monitoring_point_id、pollutant、value 均为必填' });
    }
    if (!POLLUTANTS[pollutant]) return res.status(400).json({ error: '非法污染物类型' });
    if (Number.isNaN(Number(value)) || Number(value) < 0) {
      return res.status(400).json({ error: 'value 必须为非负数值' });
    }
    const point = await db.query('SELECT id FROM monitoring_points WHERE id = $1', [pointId]);
    if (point.rows.length === 0) return res.status(404).json({ error: '监测点不存在' });

    const result = await db.withTransaction((client) =>
      alarmService.processEmissionData(client, {
        monitoring_point_id: Number(pointId),
        pollutant,
        value: Number(value),
        measured_at: measuredAt ? new Date(measuredAt) : undefined,
      })
    );
    res.status(result.exceeded ? 201 : 200).json(result);
  } catch (err) { next(err); }
});

module.exports = router;
