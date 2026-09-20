'use strict';

/**
 * 演示数据初始化：监测点、设备、历史排放数据（含一段连续超标以演示
 * 告警合并与超标事件）、处置记录。
 */
const db = require('./db');
const alarmService = require('./services/alarmService');
const eventService = require('./services/eventService');
const { POLLUTANTS } = require('./utils/standards');

const HOUR = 3600 * 1000;
const MIN = 60 * 1000;

async function seed() {
  await db.withTransaction(async (client) => {
    const points = await client.query(
      `INSERT INTO monitoring_points (code, name, location) VALUES
        ('KILN_TAIL', '窑尾烟囱', '烧成车间'),
        ('KILN_HEAD', '窑头烟囱', '烧成车间'),
        ('COAL_MILL', '煤磨排气筒', '制成车间')
       RETURNING id, code`
    );
    const pid = Object.fromEntries(points.rows.map((r) => [r.code, r.id]));

    await client.query(
      `INSERT INTO equipment (code, name, type, monitoring_point_id, status) VALUES
        ('KILN-01', '1#回转窑', 'kiln', $1, 'running'),
        ('GRATE-01', '1#篦冷机', 'cooler', $2, 'running'),
        ('MILL-01', '1#煤磨', 'mill', $3, 'running'),
        ('BAG-01', '窑尾袋式除尘器', 'dust_collector', $1, 'running'),
        ('SNCR-01', 'SNCR脱硝系统', 'denitration', $1, 'maintenance')`,
      [pid.KILN_TAIL, pid.KILN_HEAD, pid.COAL_MILL]
    );

    // 近 24 小时正常数据（每 10 分钟一条）
    const now = Date.now();
    for (let t = now - 24 * HOUR; t <= now; t += 10 * MIN) {
      for (const pointId of Object.values(pid)) {
        for (const [code, meta] of Object.entries(POLLUTANTS)) {
          const value = +(meta.limit * (0.4 + Math.random() * 0.5)).toFixed(2);
          await client.query(
            `INSERT INTO emission_data (monitoring_point_id, pollutant, value, measured_at)
             VALUES ($1,$2,$3,$4)`,
            [pointId, code, value, new Date(t)]
          );
        }
      }
    }

    // 窑尾 NOx 连续 5 次超标（间隔 5 分钟）→ 演示告警合并 + 自动生成超标事件
    let eventId = null;
    for (let i = 0; i < 5; i += 1) {
      const result = await alarmService.processEmissionData(client, {
        monitoring_point_id: pid.KILN_TAIL,
        pollutant: 'nox',
        value: +(POLLUTANTS.nox.limit * (1.15 + i * 0.08)).toFixed(2),
        measured_at: new Date(now - 25 * MIN + i * 5 * MIN),
      });
      if (result.eventId) eventId = result.eventId;
    }

    // 煤磨粉尘一次超标（单独成组，不触发事件）
    await alarmService.processEmissionData(client, {
      monitoring_point_id: pid.COAL_MILL,
      pollutant: 'dust',
      value: +(POLLUTANTS.dust.limit * 1.3).toFixed(2),
      measured_at: new Date(now - 2 * HOUR),
    });

    // 对已生成的超标事件做部分处置，演示处置流程
    if (eventId) {
      await eventService.handleEvent(client, eventId, {
        action: 'claim', operator: '张工', note: '已认领，开始排查脱硝系统',
      });
      await eventService.handleEvent(client, eventId, {
        action: 'investigate', operator: '张工', note: 'SNCR喷氨量不足，氨水浓度偏低',
      });
    }
  });
}

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  db.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'))
    .then(seed)
    .then(() => { console.log('演示数据写入完成'); return db.close(); })
    .catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { seed };
