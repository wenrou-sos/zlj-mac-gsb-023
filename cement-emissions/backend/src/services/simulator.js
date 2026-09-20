import { POLLUTANTS } from '../config.js';
import { query } from '../db/pool.js';
import { ingestReading } from './ingestion.js';
import { DEFAULT_THRESHOLDS } from './seed.js';

/**
 * 模拟 CEMS 在线监测设备持续上报：
 * 正常工况下读数在基线附近波动，小概率出现超标脉冲，
 * 便于直接体验告警合并与事件处置流程。
 */

const BASELINE = { dust: [8, 18], nox: [150, 240], so2: [45, 120] };

const rand = (min, max) => min + Math.random() * (max - min);

export function generateValue(pollutant) {
  // 约 12% 概率产生超标值
  if (Math.random() < 0.12) {
    const { warning, critical } = DEFAULT_THRESHOLDS[pollutant];
    return Math.round(rand(warning * 0.95, critical * 1.25) * 100) / 100;
  }
  const [lo, hi] = BASELINE[pollutant];
  return Math.round(rand(lo, hi) * 100) / 100;
}

export function startSimulation(intervalMs) {
  const timer = setInterval(async () => {
    try {
      const { rows: equipment } = await query(
        `SELECT id, status FROM equipment ORDER BY id`,
      );
      for (const eq of equipment) {
        // 停机设备只上报接近零值，检修/故障设备模拟异常升高
        for (const pollutant of POLLUTANTS) {
          let value;
          if (eq.status === 'stopped') value = Math.round(rand(0, 3) * 100) / 100;
          else if (eq.status === 'fault') {
            value =
              Math.round(
                rand(DEFAULT_THRESHOLDS[pollutant].warning,
                     DEFAULT_THRESHOLDS[pollutant].critical * 1.4) * 100,
              ) / 100;
          } else {
            value = generateValue(pollutant);
          }
          await ingestReading({
            equipmentId: eq.id,
            pollutant,
            value,
          });
        }
      }
    } catch (err) {
      console.error('[simulation]', err.message);
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
