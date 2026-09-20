import { query, withTransaction } from '../db/pool.js';
import { POLLUTANTS } from '../config.js';
import { ingestReading } from './ingestion.js';

/**
 * 国标 GB 4915-2013《水泥工业大气污染物排放标准》大气污染物特别排放限值参考
 * （mg/Nm³），平台默认按此设置预警/严重两级阈值。
 */
export const DEFAULT_THRESHOLDS = {
  dust: { warning: 25, critical: 30 },
  nox: { warning: 280, critical: 320 },
  so2: { warning: 170, critical: 200 },
};

export const DEFAULT_EQUIPMENT = [
  { code: 'KILN-01', name: '1#回转窑窑尾', location: '烧成车间' },
  { code: 'KILN-02', name: '2#回转窑窑头', location: '烧成车间' },
  { code: 'MILL-01', name: '1#水泥磨', location: '粉磨车间' },
  { code: 'CLN-01', name: '窑尾袋式除尘器', location: '环保岛' },
];

// 正常工况基线值（mg/Nm³）
const BASELINE = {
  dust: [8, 15],
  nox: [140, 230],
  so2: [40, 110],
};

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

export async function isSeeded() {
  const r = await query(`SELECT COUNT(*)::int AS c FROM equipment`);
  return r.rows[0].c > 0;
}

/**
 * 初始化主数据：设备 + 全局默认限值
 */
export async function seedMasterData() {
  for (const e of DEFAULT_EQUIPMENT) {
    await query(
      `INSERT INTO equipment (code, name, location) VALUES ($1,$2,$3)
       ON CONFLICT (code) DO NOTHING`,
      [e.code, e.name, e.location],
    );
  }
  for (const pollutant of POLLUTANTS) {
    const { warning, critical } = DEFAULT_THRESHOLDS[pollutant];
    await query(
      `INSERT INTO thresholds (equipment_id, pollutant, warning, critical)
       VALUES (NULL, $1, $2, $3)
       ON CONFLICT (equipment_id, pollutant) DO NOTHING`,
      [pollutant, warning, critical],
    );
  }
}

/**
 * 生成过去 hours 小时的历史读数（含少量超标工况，触发告警合并与事件）。
 * 每 5 分钟一条，每个设备每种污染物。
 */
export async function seedHistory(hours = 24) {
  const equipments = await query(`SELECT id, code FROM equipment`);
  const stepMs = 5 * 60 * 1000;
  const start = Date.now() - hours * 60 * 60 * 1000;

  for (const eq of equipments.rows) {
    for (const pollutant of POLLUTANTS) {
      const [lo, hi] = BASELINE[pollutant];
      let inEpisode = false;
      let episodeLeft = 0;

      for (let t = start; t < Date.now() - stepMs; t += stepMs) {
        // 约 4% 概率开始一段持续 2-6 个采样点的超标工况
        if (!inEpisode && Math.random() < 0.04) {
          inEpisode = true;
          episodeLeft = 2 + Math.floor(Math.random() * 5);
        }
        let value;
        if (inEpisode) {
          const { critical } = DEFAULT_THRESHOLDS[pollutant];
          value = round3(critical * rand(0.9, 1.35));
          episodeLeft -= 1;
          if (episodeLeft <= 0) inEpisode = false;
        } else {
          value = round3(rand(lo, hi));
        }
        await ingestReading({
          equipmentId: eq.id,
          pollutant,
          value,
          measuredAt: new Date(t),
        });
      }
    }
  }
}

export async function seedIfEmpty({ withHistory = true } = {}) {
  if (await isSeeded()) return false;
  await withTransaction(async () => {
    await seedMasterData();
  });
  if (withHistory) await seedHistory(24);
  return true;
}
