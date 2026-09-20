'use strict';

const express = require('express');
const db = require('../db');
const { POLLUTANTS } = require('../utils/standards');

const router = express.Router();

/** GET /api/overview 驾驶舱汇总：各监测点最新值、告警/事件/设备统计 */
router.get('/', async (req, res, next) => {
  try {
    const [latest, alarmStats, eventStats, equipStats] = await Promise.all([
      db.query(
        `SELECT DISTINCT ON (monitoring_point_id, pollutant)
                monitoring_point_id, pollutant, value, unit, measured_at
           FROM emission_data
          ORDER BY monitoring_point_id, pollutant, measured_at DESC`
      ),
      db.query(
        `SELECT status, count(*)::int AS c FROM alarm_groups GROUP BY status`
      ),
      db.query(
        `SELECT status, count(*)::int AS c FROM exceedance_events GROUP BY status`
      ),
      db.query(
        `SELECT status, count(*)::int AS c FROM equipment GROUP BY status`
      ),
    ]);

    const latestMap = {};
    for (const row of latest.rows) {
      const key = `${row.monitoring_point_id}:${row.pollutant}`;
      const meta = POLLUTANTS[row.pollutant];
      latestMap[key] = {
        ...row,
        limit: meta ? meta.limit : null,
        exceeded: meta ? Number(row.value) > meta.limit : false,
      };
    }
    const toMap = (rows) => rows.reduce((m, r) => ({ ...m, [r.status]: r.c }), {});
    res.json({
      latest: latestMap,
      alarms: toMap(alarmStats.rows),
      events: toMap(eventStats.rows),
      equipment: toMap(equipStats.rows),
      standards: POLLUTANTS,
    });
  } catch (err) { next(err); }
});

module.exports = router;
