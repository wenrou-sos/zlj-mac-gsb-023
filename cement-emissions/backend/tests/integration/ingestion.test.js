import { describe, it, expect, beforeAll } from 'vitest';
import { query } from '../../src/db/pool.js';
import { ingestReading } from '../../src/services/ingestion.js';

const T = (min) => new Date(`2026-09-19T${10}:00:00Z`).getTime() + min * 60000;
const at = (min) => new Date(T(min));

let EQ1;

beforeAll(async () => {
  ({ rows: [EQ1] } = await query(
    `INSERT INTO equipment (code, name, location) VALUES ('T-KILN','测试窑','测试区') RETURNING *`,
  ));
});

describe('读数摄入与告警合并', () => {
  it('正常读数只入库，不产生告警', async () => {
    const r = await ingestReading({
      equipmentId: EQ1.id, pollutant: 'dust', value: 10, measuredAt: at(0),
    });
    expect(r.level).toBe('ok');
    expect(r.alarmGroup).toBeNull();
    const alarms = await query(`SELECT COUNT(*)::int c FROM alarms`);
    expect(alarms.rows[0].c).toBe(0);
  });

  it('首次超标创建 active 告警组并自动创建 open 处置事件', async () => {
    const r = await ingestReading({
      equipmentId: EQ1.id, pollutant: 'dust', value: 26, measuredAt: at(1),
    });
    expect(r.level).toBe('warning');
    expect(r.merged).toBe(false);
    expect(r.alarmGroup.status).toBe('active');
    expect(r.alarmGroup.alarm_count).toBe(1);
    expect(r.alarmGroup.peak_value).toBe('26.000');
    expect(r.event).toBeTruthy();
    expect(r.event.status).toBe('open');

    const ev = await query(`SELECT * FROM events WHERE alarm_group_id = $1`, [
      r.alarmGroup.id,
    ]);
    expect(ev.rowCount).toBe(1);
  });

  it('合并窗口内连续超标合并进同一组，计数累加且只保留一个事件', async () => {
    const r2 = await ingestReading({
      equipmentId: EQ1.id, pollutant: 'dust', value: 27, measuredAt: at(3),
    });
    expect(r2.merged).toBe(true);
    expect(r2.alarmGroup.alarm_count).toBe(2);
    expect(r2.alarmGroup.peak_value).toBe('27.000');

    const r3 = await ingestReading({
      equipmentId: EQ1.id, pollutant: 'dust', value: 28, measuredAt: at(9),
    });
    expect(r3.merged).toBe(true);
    expect(r3.alarmGroup.alarm_count).toBe(3);

    const events = await query(
      `SELECT COUNT(*)::int c FROM events WHERE equipment_id = $1 AND pollutant = 'dust'`,
      [EQ1.id],
    );
    expect(events.rows[0].c).toBe(1);

    const alarms = await query(
      `SELECT COUNT(*)::int c FROM alarms WHERE group_id = $1`,
      [r3.alarmGroup.id],
    );
    expect(alarms.rows[0].c).toBe(3);
  });

  it('合并到 critical 读数时事件严重度升级，峰值更新', async () => {
    const r = await ingestReading({
      equipmentId: EQ1.id, pollutant: 'dust', value: 35, measuredAt: at(10),
    });
    expect(r.merged).toBe(true);
    expect(r.alarmGroup.severity).toBe('critical');
    expect(r.alarmGroup.peak_value).toBe('35.000');

    const ev = await query(`SELECT * FROM events WHERE alarm_group_id = $1`, [
      r.alarmGroup.id,
    ]);
    expect(ev.rows[0].severity).toBe('critical');
    expect(Number(ev.rows[0].peak_value)).toBe(35);
  });

  it('读数恢复正常后告警组自动消解，事件自动置为 resolved', async () => {
    const r = await ingestReading({
      equipmentId: EQ1.id, pollutant: 'dust', value: 12, measuredAt: at(12),
    });
    expect(r.level).toBe('ok');

    const groups = await query(
      `SELECT status, event_id FROM alarm_groups WHERE equipment_id = $1 AND pollutant='dust' ORDER BY id`,
      [EQ1.id],
    );
    expect(groups.rows.at(-1).status).toBe('resolved');

    const ev = await query(`SELECT * FROM events WHERE id = $1`, [
      groups.rows.at(-1).event_id,
    ]);
    expect(ev.rows[0].status).toBe('resolved');
    expect(ev.rows[0].resolution).toContain('恢复');
    expect(ev.rows[0].resolved_at).not.toBeNull();

    const actions = await query(
      `SELECT action FROM event_actions WHERE event_id = $1 ORDER BY id`,
      [ev.rows[0].id],
    );
    expect(actions.rows[0].action).toBe('created');
    expect(actions.rows.at(-1).action).toBe('resolve');
  });
});

describe('合并窗口边界', () => {
  it('超过 10 分钟窗口的超标新开告警组与事件', async () => {
    const { rows: [eq] } = await query(
      `INSERT INTO equipment (code,name) VALUES ('T-MILL','测试磨') RETURNING *`,
    );
    const r1 = await ingestReading({
      equipmentId: eq.id, pollutant: 'so2', value: 180, measuredAt: at(0),
    });
    // 11 分钟后再次超标：超出默认 10 分钟合并窗口
    const r2 = await ingestReading({
      equipmentId: eq.id, pollutant: 'so2', value: 185, measuredAt: at(11),
    });
    expect(r2.merged).toBe(false);
    expect(r2.alarmGroup.id).not.toBe(r1.alarmGroup.id);

    const events = await query(
      `SELECT COUNT(*)::int c FROM events WHERE equipment_id = $1`,
      [eq.id],
    );
    expect(events.rows[0].c).toBe(2);
  });
});

describe('设备状态关联抑制', () => {
  it('停机设备超标只产生 suppressed 组，不创建事件', async () => {
    const { rows: [eq] } = await query(
      `INSERT INTO equipment (code,name,status) VALUES ('T-STOP','停机设备','stopped') RETURNING *`,
    );
    const r1 = await ingestReading({
      equipmentId: eq.id, pollutant: 'nox', value: 400, measuredAt: at(0),
    });
    expect(r1.suppressed).toBe(true);
    expect(r1.alarmGroup.status).toBe('suppressed');
    expect(r1.alarmGroup.suppression_reason).toContain('停机');

    // 抑制组不参与合并，后续超标继续被抑制为新组
    const r2 = await ingestReading({
      equipmentId: eq.id, pollutant: 'nox', value: 410, measuredAt: at(2),
    });
    expect(r2.alarmGroup.status).toBe('suppressed');
    expect(r2.alarmGroup.id).not.toBe(r1.alarmGroup.id);

    const events = await query(
      `SELECT COUNT(*)::int c FROM events WHERE equipment_id = $1`,
      [eq.id],
    );
    expect(events.rows[0].c).toBe(0);
  });

  it('检修恢复运行后超标正常告警', async () => {
    const { rows: [eq] } = await query(
      `INSERT INTO equipment (code,name,status) VALUES ('T-MNT','检修设备','maintenance') RETURNING *`,
    );
    const suppressed = await ingestReading({
      equipmentId: eq.id, pollutant: 'dust', value: 50, measuredAt: at(0),
    });
    expect(suppressed.suppressed).toBe(true);

    await query(`UPDATE equipment SET status='running' WHERE id=$1`, [eq.id]);
    const normal = await ingestReading({
      equipmentId: eq.id, pollutant: 'dust', value: 26, measuredAt: at(1),
    });
    expect(normal.alarmGroup.status).toBe('active');
    expect(normal.event).toBeTruthy();
  });

  it('故障设备的超标仍然告警（需重点关注）', async () => {
    const { rows: [eq] } = await query(
      `INSERT INTO equipment (code,name,status) VALUES ('T-FAULT','故障设备','fault') RETURNING *`,
    );
    const r = await ingestReading({
      equipmentId: eq.id, pollutant: 'dust', value: 40, measuredAt: at(0),
    });
    expect(r.alarmGroup.status).toBe('active');
    expect(r.suppressed).toBeUndefined();
  });
});

describe('限值层级', () => {
  it('critical 读数首次即生成严重告警组', async () => {
    const { rows: [eq] } = await query(
      `INSERT INTO equipment (code,name) VALUES ('T-CRT','严重超标设备') RETURNING *`,
    );
    const r = await ingestReading({
      equipmentId: eq.id, pollutant: 'nox', value: 330, measuredAt: at(0),
    });
    expect(r.level).toBe('critical');
    expect(r.alarmGroup.severity).toBe('critical');
    const alarm = await query(`SELECT level, limit_value FROM alarms WHERE group_id=$1`, [
      r.alarmGroup.id,
    ]);
    expect(alarm.rows[0].level).toBe('critical');
    expect(Number(alarm.rows[0].limit_value)).toBe(320);
  });

  it('设备专属限值优先于全局限值', async () => {
    const { rows: [eq] } = await query(
      `INSERT INTO equipment (code,name) VALUES ('T-CUSTOM','定制限值设备') RETURNING *`,
    );
    await query(
      `INSERT INTO thresholds (equipment_id, pollutant, warning, critical)
       VALUES ($1,'dust',40,50)`,
      [eq.id],
    );
    const r = await ingestReading({
      equipmentId: eq.id, pollutant: 'dust', value: 30, measuredAt: at(0),
    });
    expect(r.level).toBe('ok');
    const r2 = await ingestReading({
      equipmentId: eq.id, pollutant: 'dust', value: 45, measuredAt: at(1),
    });
    expect(r2.level).toBe('warning');
  });

  it('不存在的设备返回 404 语义错误', async () => {
    await expect(
      ingestReading({ equipmentId: 99999, pollutant: 'dust', value: 1 }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
