'use strict';

/**
 * 演示数据发生器：周期性为各监测点生成三种污染物的监测值，
 * 小概率产生超标数据以触发告警合并与超标事件流程。
 */
const db = require('./db');
const config = require('./config');
const alarmService = require('./services/alarmService');
const { POLLUTANTS } = require('./utils/standards');

function randomValue(pollutant) {
  const { limit } = POLLUTANTS[pollutant];
  const r = Math.random();
  if (r < 0.06) return +(limit * (1.1 + Math.random() * 0.7)).toFixed(2); // 6% 超标
  return +(limit * (0.4 + Math.random() * 0.5)).toFixed(2);
}

async function tick() {
  try {
    const { rows: points } = await db.query('SELECT id FROM monitoring_points');
    for (const point of points) {
      for (const pollutant of Object.keys(POLLUTANTS)) {
        await db.withTransaction((client) =>
          alarmService.processEmissionData(client, {
            monitoring_point_id: point.id,
            pollutant,
            value: randomValue(pollutant),
          })
        );
      }
    }
  } catch (err) {
    console.error('[simulator] 数据生成失败:', err.message);
  }
}

function startSimulator() {
  console.log(`[simulator] 已启动，间隔 ${config.simulator.intervalMs}ms`);
  const timer = setInterval(tick, config.simulator.intervalMs);
  timer.unref();
  return timer;
}

module.exports = { startSimulator, randomValue };
