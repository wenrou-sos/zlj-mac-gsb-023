import { describe, it, expect, beforeAll } from 'vitest';
import { query } from '../../src/db/pool.js';
import { ingestReading } from '../../src/services/ingestion.js';
import {
  advanceEvent,
  assignEvent,
  commentEvent,
} from '../../src/services/event-service.js';

let EQ1;
let groupId;
let eventId;

beforeAll(async () => {
  ({ rows: [EQ1] } = await query(
    `INSERT INTO equipment (code,name) VALUES ('E-EVT','事件处置设备') RETURNING *`,
  ));
  const r = await ingestReading({
    equipmentId: EQ1.id,
    pollutant: 'dust',
    value: 33,
    measuredAt: new Date('2026-09-19T08:00:00Z'),
  });
  groupId = r.alarmGroup.id;
  eventId = r.event.id;
});

describe('超标事件完整处置流程', () => {
  it('事件初始为 open 且自动写入 created 过程记录', async () => {
    const ev = await query(`SELECT * FROM events WHERE id=$1`, [eventId]);
    expect(ev.rows[0].status).toBe('open');
    expect(ev.rows[0].handler).toBeNull();

    const actions = await query(
      `SELECT * FROM event_actions WHERE event_id=$1 ORDER BY id`,
      [eventId],
    );
    expect(actions.rows).toHaveLength(1);
    expect(actions.rows[0].action).toBe('created');
    expect(actions.rows[0].note).toContain('超标');
  });

  it('指派负责人并记录', async () => {
    await assignEvent(eventId, { handler: '张工', actor: '调度员' });
    const ev = await query(`SELECT handler FROM events WHERE id=$1`, [eventId]);
    expect(ev.rows[0].handler).toBe('张工');

    const actions = await query(
      `SELECT action, actor, note FROM event_actions WHERE event_id=$1 ORDER BY id`,
      [eventId],
    );
    expect(actions.rows.at(-1).action).toBe('assign');
    expect(actions.rows.at(-1).note).toContain('张工');
  });

  it('open -> dispatched 派单', async () => {
    const ev = await advanceEvent(eventId, {
      toStatus: 'dispatched',
      actor: '调度员',
      note: '已通知环保车间',
    });
    expect(ev.status).toBe('dispatched');
  });

  it('dispatched -> handling 开始处置', async () => {
    const ev = await advanceEvent(eventId, {
      toStatus: 'handling',
      actor: '张工',
      note: '到场检查袋式除尘器',
    });
    expect(ev.status).toBe('handling');
  });

  it('处置完成必须填写措施说明', async () => {
    await expect(
      advanceEvent(eventId, { toStatus: 'resolved', actor: '张工' }),
    ).rejects.toThrow(/处置措施/);
  });

  it('handling -> resolved 处置完成', async () => {
    const ev = await advanceEvent(eventId, {
      toStatus: 'resolved',
      actor: '张工',
      resolution: '更换破损滤袋 12 条，清灰系统恢复正常',
    });
    expect(ev.status).toBe('resolved');
    expect(ev.resolution).toContain('滤袋');
    expect(ev.resolved_at).not.toBeNull();
  });

  it('resolved -> closed 归档关闭', async () => {
    const ev = await advanceEvent(eventId, {
      toStatus: 'closed',
      actor: '值班长',
      note: '复测达标，同意关闭',
    });
    expect(ev.status).toBe('closed');
    expect(ev.closed_at).not.toBeNull();
  });

  it('closed 终态不可再流转', async () => {
    await expect(
      advanceEvent(eventId, { toStatus: 'handling', actor: '张工' }),
    ).rejects.toThrow(/不允许从/);
  });

  it('全过程时间线完整且顺序正确', async () => {
    const { rows } = await query(
      `SELECT action, from_status, to_status, actor, note
         FROM event_actions WHERE event_id=$1 ORDER BY id`,
      [eventId],
    );
    expect(rows.map((r) => r.action)).toEqual([
      'created',
      'assign',
      'dispatch',
      'handle',
      'resolve',
      'close',
    ]);
    expect(rows[1].to_status).toBeNull(); // assign 不改状态
    expect(rows[2].from_status).toBe('open');
    expect(rows[2].to_status).toBe('dispatched');
    expect(rows[5].from_status).toBe('resolved');
  });

  it('可追加备注', async () => {
    await commentEvent(eventId, { actor: '张工', note: '已上报环保部门备案' });
    const { rows } = await query(
      `SELECT action, note FROM event_actions WHERE event_id=$1 ORDER BY id DESC LIMIT 1`,
      [eventId],
    );
    expect(rows[0].action).toBe('comment');
    expect(rows[0].note).toBe('已上报环保部门备案');
  });
});

describe('非法流转', () => {
  it('open 不允许直接 resolved', async () => {
    const { rows: [eq] } = await query(
      `INSERT INTO equipment (code,name) VALUES ('E-BAD','非法流转设备') RETURNING *`,
    );
    const r = await ingestReading({
      equipmentId: eq.id,
      pollutant: 'so2',
      value: 220,
      measuredAt: new Date('2026-09-19T09:00:00Z'),
    });
    await expect(
      advanceEvent(r.event.id, {
        toStatus: 'resolved',
        resolution: 'x',
        actor: 'a',
      }),
    ).rejects.toThrow(/不允许从/);
  });

  it('不存在的事件抛 404', async () => {
    await expect(
      advanceEvent(987654, { toStatus: 'handling' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('告警确认', () => {
  it('active 告警组可被确认，确认后窗口内告警仍合并', async () => {
    const { rows: [eq] } = await query(
      `INSERT INTO equipment (code,name) VALUES ('E-ACK','确认设备') RETURNING *`,
    );
    const r1 = await ingestReading({
      equipmentId: eq.id,
      pollutant: 'nox',
      value: 300,
      measuredAt: new Date('2026-09-19T10:00:00Z'),
    });
    await query(`UPDATE alarm_groups SET status='acknowledged' WHERE id=$1`, [
      r1.alarmGroup.id,
    ]);
    const r2 = await ingestReading({
      equipmentId: eq.id,
      pollutant: 'nox',
      value: 305,
      measuredAt: new Date('2026-09-19T10:05:00Z'),
    });
    expect(r2.merged).toBe(true);
    expect(r2.alarmGroup.status).toBe('acknowledged');

    // 读数恢复正常后，即便组已确认，事件仍应自动消解
    const r3 = await ingestReading({
      equipmentId: eq.id,
      pollutant: 'nox',
      value: 100,
      measuredAt: new Date('2026-09-19T10:06:00Z'),
    });
    expect(r3.level).toBe('ok');
    const ev = await query(`SELECT status FROM events WHERE id=$1`, [
      r1.event.id,
    ]);
    expect(ev.rows[0].status).toBe('resolved');
  });
});
