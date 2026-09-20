'use strict';

/**
 * 端到端集成测试：使用 pg-mem 内存 PostgreSQL 真实执行
 * 建表 → 种子数据 → 告警合并 → 超标事件 → 处置流转 → 设备联动。
 */

jest.mock('../src/db', () => {
  const { newDb } = require('pg-mem');
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();
  return {
    _pool: pool,
    query: (text, params) => pool.query(text, params),
    withTransaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: async () => {},
  };
});

const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const { seed } = require('../src/seed');
const alarmService = require('../src/services/alarmService');
const eventService = require('../src/services/eventService');
const equipmentService = require('../src/services/equipmentService');

beforeAll(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/schema.sql'), 'utf8');
  await db.query(sql);
  await seed();
});

describe('种子数据与 schema', () => {
  test('监测点、设备、排放数据已写入', async () => {
    const points = await db.query('SELECT count(*)::int AS c FROM monitoring_points');
    const equip = await db.query('SELECT count(*)::int AS c FROM equipment');
    const data = await db.query('SELECT count(*)::int AS c FROM emission_data');
    expect(points.rows[0].c).toBe(3);
    expect(equip.rows[0].c).toBe(5);
    expect(data.rows[0].c).toBeGreaterThan(1000);
  });

  test('窑尾 NOx 连续超标合并为一个告警组并生成超标事件', async () => {
    const groups = await db.query(
      `SELECT * FROM alarm_groups WHERE pollutant = 'nox' ORDER BY id`
    );
    expect(groups.rows.length).toBe(1);
    expect(groups.rows[0].alarm_count).toBe(5);

    const events = await db.query(
      `SELECT * FROM exceedance_events WHERE alarm_group_id = $1`, [groups.rows[0].id]);
    expect(events.rows.length).toBe(1);
    expect(events.rows[0].status).toBe('processing'); // 种子数据中已认领+排查
  });

  test('煤磨粉尘单次超标单独成组，不生成事件', async () => {
    const groups = await db.query(
      `SELECT g.*, e.id AS event_id FROM alarm_groups g
        LEFT JOIN exceedance_events e ON e.alarm_group_id = g.id
       WHERE g.pollutant = 'dust'`
    );
    expect(groups.rows.length).toBe(1);
    expect(groups.rows[0].alarm_count).toBe(1);
    expect(groups.rows[0].event_id).toBeNull();
  });
});

describe('告警合并窗口（真实 SQL）', () => {
  test('窗口内合并、超窗新建组', async () => {
    const t0 = new Date('2026-09-19T08:00:00Z');
    const mk = (min) => new Date(t0.getTime() + min * 60000);

    // 连续 2 条（间隔 10 分钟，窗口 30 分钟内）→ 合并
    await db.withTransaction((c) => alarmService.processEmissionData(c, {
      monitoring_point_id: 2, pollutant: 'so2', value: 150, measured_at: mk(0),
    }));
    await db.withTransaction((c) => alarmService.processEmissionData(c, {
      monitoring_point_id: 2, pollutant: 'so2', value: 160, measured_at: mk(10),
    }));
    // 间隔 60 分钟 → 超出合并窗口，新建组
    await db.withTransaction((c) => alarmService.processEmissionData(c, {
      monitoring_point_id: 2, pollutant: 'so2', value: 170, measured_at: mk(70),
    }));

    const { rows } = await db.query(
      `SELECT * FROM alarm_groups
        WHERE monitoring_point_id = 2 AND pollutant = 'so2' ORDER BY id`
    );
    expect(rows.length).toBe(2);
    expect(rows[0].alarm_count).toBe(2);
    expect(Number(rows[0].max_value)).toBe(160);
    expect(rows[1].alarm_count).toBe(1);
  });
});

describe('超标事件处置流转（真实 SQL）', () => {
  test('完整处置流程并落库处置记录', async () => {
    // 制造一个新的超标事件（3 次连续超标）
    const t0 = Date.now();
    let eventId = null;
    for (let i = 0; i < 3; i += 1) {
      const r = await db.withTransaction((c) => alarmService.processEmissionData(c, {
        monitoring_point_id: 3, pollutant: 'nox', value: 400 + i * 10,
        measured_at: new Date(t0 + i * 60000),
      }));
      if (r.eventId) eventId = r.eventId;
    }
    expect(eventId).not.toBeNull();

    await db.withTransaction((c) => eventService.handleEvent(c, eventId, { action: 'claim', operator: '李工' }));
    await db.withTransaction((c) => eventService.handleEvent(c, eventId, { action: 'measure', operator: '李工', note: '加大喷氨量' }));
    const resolved = await db.withTransaction((c) => eventService.handleEvent(c, eventId, { action: 'resolve', operator: '李工', note: '已恢复正常' }));
    expect(resolved.status).toBe('resolved');
    expect(resolved.ended_at).not.toBeNull();

    const records = await db.query(
      'SELECT * FROM handling_records WHERE event_id = $1 ORDER BY id', [eventId]);
    expect(records.rows.map((r) => r.action)).toEqual(['claim', 'measure', 'resolve']);

    // 办结后不可再处置
    await expect(
      db.withTransaction((c) => eventService.handleEvent(c, eventId, { action: 'claim', operator: '李工' }))
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('设备状态联动（真实 SQL）', () => {
  test('设备转检修后活动告警组关闭且免考核，新告警不再生成事件', async () => {
    // 制造活动告警组（种子数据已含 1 个活动粉尘组，新建后应为 +1）
    const prior = await db.query(
      `SELECT count(*)::int AS c FROM alarm_groups
        WHERE monitoring_point_id = 3 AND pollutant = 'dust' AND status = 'active'`);
    await db.withTransaction((c) => alarmService.processEmissionData(c, {
      monitoring_point_id: 3, pollutant: 'dust', value: 30, measured_at: new Date(),
    }));
    const before = await db.query(
      `SELECT count(*)::int AS c FROM alarm_groups
        WHERE monitoring_point_id = 3 AND pollutant = 'dust' AND status = 'active'`);
    expect(before.rows[0].c).toBe(prior.rows[0].c + 1);

    // 煤磨（monitoring_point 3 的设备）转检修
    const { rows: mills } = await db.query(
      `SELECT id FROM equipment WHERE monitoring_point_id = 3 LIMIT 1`);
    const result = await db.withTransaction((c) =>
      equipmentService.updateEquipmentStatus(c, mills[0].id, 'maintenance'));
    expect(result.closedGroups.length).toBeGreaterThan(0);

    // 新超标告警应免考核且不生成事件
    const r = await db.withTransaction((c) => alarmService.processEmissionData(c, {
      monitoring_point_id: 3, pollutant: 'dust', value: 35, measured_at: new Date(),
    }));
    expect(r.exceeded).toBe(true);
    expect(r.eventId).toBeNull();
    const g = await db.query('SELECT * FROM alarm_groups WHERE id = $1', [r.groupId]);
    expect(g.rows[0].exempt).toBe(true);
    expect(g.rows[0].equipment_status).toBe('maintenance');

    // 恢复运行
    await db.withTransaction((c) =>
      equipmentService.updateEquipmentStatus(c, mills[0].id, 'running'));
  });

  test('非法设备状态返回 400', async () => {
    await expect(
      db.withTransaction((c) => equipmentService.updateEquipmentStatus(c, 1, 'broken'))
    ).rejects.toMatchObject({ status: 400 });
  });
});
