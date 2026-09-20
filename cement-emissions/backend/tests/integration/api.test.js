import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { query } from '../../src/db/pool.js';

const app = createApp();

describe('GET /api/health', () => {
  it('返回健康状态', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('设备接口', () => {
  it('返回种子设备列表', async () => {
    const res = await request(app).get('/api/equipment');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(4);
    expect(res.body.map((e) => e.code)).toContain('KILN-01');
  });

  it('切换设备状态', async () => {
    const { rows } = await query(`SELECT id FROM equipment WHERE code='KILN-01'`);
    const res = await request(app)
      .patch(`/api/equipment/${rows[0].id}/status`)
      .send({ status: 'maintenance' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('maintenance');
  });

  it('非法设备状态被数据库约束拒绝', async () => {
    const { rows } = await query(`SELECT id FROM equipment WHERE code='KILN-02'`);
    const res = await request(app)
      .patch(`/api/equipment/${rows[0].id}/status`)
      .send({ status: 'exploded' });
    expect(res.status).toBe(400);
  });

  it('更新不存在的设备返回 404', async () => {
    const res = await request(app)
      .patch('/api/equipment/999999/status')
      .send({ status: 'running' });
    expect(res.status).toBe(404);
  });
});

describe('限值接口', () => {
  it('返回三种污染物的全局限值', async () => {
    const res = await request(app).get('/api/thresholds');
    expect(res.status).toBe(200);
    const pollutants = res.body.map((t) => t.pollutant);
    expect(pollutants).toEqual(expect.arrayContaining(['dust', 'nox', 'so2']));
  });

  it('可设置设备专属限值', async () => {
    const { rows } = await query(`SELECT id FROM equipment WHERE code='MILL-01'`);
    const res = await request(app)
      .put('/api/thresholds')
      .send({ equipmentId: rows[0].id, pollutant: 'dust', warning: 20, critical: 25 });
    expect(res.status).toBe(200);
    expect(Number(res.body.warning)).toBe(20);
  });

  it('严重限值必须大于预警限值', async () => {
    const res = await request(app)
      .put('/api/thresholds')
      .send({ pollutant: 'dust', warning: 30, critical: 20 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('严重限值');
  });

  it('缺少必填字段返回 400', async () => {
    const res = await request(app)
      .put('/api/thresholds')
      .send({ pollutant: 'dust' });
    expect(res.status).toBe(400);
  });
});

describe('读数接口', () => {
  it('缺少必填参数返回 400', async () => {
    const res = await request(app).post('/api/readings').send({ pollutant: 'dust' });
    expect(res.status).toBe(400);
  });

  it('非法污染物返回 400', async () => {
    const res = await request(app)
      .post('/api/readings')
      .send({ equipmentId: 1, pollutant: 'co2', value: 1 });
    expect(res.status).toBe(400);
  });

  it('负数读数返回 400', async () => {
    const res = await request(app)
      .post('/api/readings')
      .send({ equipmentId: 1, pollutant: 'dust', value: -5 });
    expect(res.status).toBe(400);
  });

  it('设备不存在返回 404', async () => {
    const res = await request(app)
      .post('/api/readings')
      .send({ equipmentId: 999999, pollutant: 'dust', value: 1 });
    expect(res.status).toBe(404);
  });

  it('超标读数提交后返回告警组与事件，并可查询历史序列', async () => {
    const { rows } = await query(`SELECT id FROM equipment WHERE code='CLN-01'`);
    const id = rows[0].id;

    const ok = await request(app)
      .post('/api/readings')
      .send({ equipmentId: id, pollutant: 'dust', value: 12 });
    expect(ok.status).toBe(201);
    expect(ok.body.level).toBe('ok');

    const bad = await request(app)
      .post('/api/readings')
      .send({ equipmentId: id, pollutant: 'dust', value: 31 });
    expect(bad.status).toBe(201);
    expect(bad.body.level).toBe('critical');
    expect(bad.body.alarmGroup.status).toBe('active');
    expect(bad.body.event.status).toBe('open');

    const series = await request(app)
      .get(`/api/readings?equipmentId=${id}&pollutant=dust&hours=1`);
    expect(series.status).toBe(200);
    expect(series.body.length).toBe(2);
  });
});

describe('告警与事件接口', () => {
  it('可查看告警组列表、详情，并确认', async () => {
    const list = await request(app).get('/api/alarms?status=active');
    expect(list.status).toBe(200);
    const group = list.body[0];
    expect(group.equipment_name).toBeTruthy();

    const detail = await request(app).get(`/api/alarms/${group.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.alarms.length).toBeGreaterThan(0);

    const ack = await request(app)
      .post(`/api/alarms/${group.id}/acknowledge`)
      .send({ actor: 'tester' });
    expect(ack.status).toBe(200);
    expect(ack.body.status).toBe('acknowledged');

    const again = await request(app)
      .post(`/api/alarms/${group.id}/acknowledge`)
      .send({});
    expect(again.status).toBe(409);
  });

  it('事件可推进完整处置流程，非法流转返回 400', async () => {
    const list = await request(app).get('/api/events?status=open');
    expect(list.status).toBe(200);
    const event = list.body[0];

    const illegal = await request(app)
      .post(`/api/events/${event.id}/transition`)
      .send({ toStatus: 'resolved', resolution: 'x' });
    expect(illegal.status).toBe(400);

    for (const [toStatus, actor, extra] of [
      ['dispatched', '调度员', { note: '派单' }],
      ['handling', '张工', { note: '到场' }],
      ['resolved', '张工', { resolution: '更换滤袋' }],
      ['closed', '值班长', { note: '归档' }],
    ]) {
      const res = await request(app)
        .post(`/api/events/${event.id}/transition`)
        .send({ toStatus, actor, ...extra });
      expect(res.status, `-> ${toStatus}`).toBe(200);
      expect(res.body.status).toBe(toStatus);
    }

    const detail = await request(app).get(`/api/events/${event.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.timeline.map((a) => a.action)).toEqual([
      'created', 'dispatch', 'handle', 'resolve', 'close',
    ]);
    expect(detail.body.alarms.length).toBeGreaterThan(0);
  });

  it('事件处置完成必须填写措施', async () => {
    // 制造一个 handling 事件
    const { rows } = await query(`SELECT id FROM equipment WHERE code='KILN-01'`);
    // 设备当前为 maintenance，先恢复 running
    await request(app)
      .patch(`/api/equipment/${rows[0].id}/status`)
      .send({ status: 'running' });
    await request(app)
      .post('/api/readings')
      .send({ equipmentId: rows[0].id, pollutant: 'so2', value: 210 });
    const list = await request(app).get('/api/events?status=open');
    const event = list.body.find(
      (e) => e.equipment_code === 'KILN-01' && e.pollutant === 'so2',
    );
    await request(app)
      .post(`/api/events/${event.id}/transition`)
      .send({ toStatus: 'handling', actor: '张工' });
    const res = await request(app)
      .post(`/api/events/${event.id}/transition`)
      .send({ toStatus: 'resolved', actor: '张工' });
    expect(res.status).toBe(400);
  });

  it('事件不存在返回 404', async () => {
    const res = await request(app).get('/api/events/999999');
    expect(res.status).toBe(404);
  });
});

describe('总览接口', () => {
  it('聚合设备/告警/事件统计与最新读数', async () => {
    const res = await request(app).get('/api/overview');
    expect(res.status).toBe(200);
    expect(res.body.equipmentByStatus.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.alarmsByStatusSeverity)).toBe(true);
    expect(Array.isArray(res.body.eventsByStatus)).toBe(true);
    expect(Array.isArray(res.body.latestReadings)).toBe(true);
  });
});

describe('未知接口', () => {
  it('返回 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
  });
});
