import { query } from '../db/pool.js';

/**
 * 总览统计：设备状态分布、活跃告警/待办事件、今日超标次数、峰值
 */
export async function getOverview() {
  const [equipmentStats, alarmStats, eventStats, todayStats, latest] =
    await Promise.all([
      query(
        `SELECT status, COUNT(*)::int AS count FROM equipment GROUP BY status`,
      ),
      query(
        `SELECT status, severity, COUNT(*)::int AS count
           FROM alarm_groups GROUP BY status, severity`,
      ),
      query(
        `SELECT status, COUNT(*)::int AS count FROM events GROUP BY status`,
      ),
      query(
        `SELECT pollutant, COUNT(*)::int AS count,
                MAX(value)::numeric(12,2) AS peak
           FROM alarms
          WHERE created_at >= date_trunc('day', now())
          GROUP BY pollutant`,
      ),
      query(
        `SELECT DISTINCT ON (equipment_id, pollutant)
                equipment_id, pollutant, value, measured_at
           FROM readings ORDER BY equipment_id, pollutant, measured_at DESC`,
      ),
    ]);

  return {
    equipmentByStatus: equipmentStats.rows,
    alarmsByStatusSeverity: alarmStats.rows,
    eventsByStatus: eventStats.rows,
    todayAlarms: todayStats.rows,
    latestReadings: latest.rows,
  };
}
