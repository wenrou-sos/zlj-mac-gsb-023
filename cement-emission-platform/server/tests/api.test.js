'use strict';

const request = require('supertest');

jest.mock('../src/db', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
  close: jest.fn(),
}));

const db = require('../src/db');
const { createApp } = require('../src/app');

const app = createApp();

beforeEach(() => {
  db.query.mockReset();
  db.withTransaction.mockReset();
});

describe('健康检查与基础校验', () => {
  test('GET /api/health 数据库正常返回 ok', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('GET /api/health 数据库异常返回 503', async () => {
    db.query.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
  });

  test('未知路由返回 404', async () => {
    const res = await request(app).get('/api/not-exist');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/emissions 数据上报', () => {
  test('缺少必填字段返回 400', async () => {
    const res = await request(app).post('/api/emissions').send({ pollutant: 'dust' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/必填/);
  });

  test('非法污染物返回 400', async () => {
    const res = await request(app).post('/api/emissions')
      .send({ monitoring_point_id: 1, pollutant: 'co', value: 10 });
    expect(res.status).toBe(400);
  });

  test('负数数值返回 400', async () => {
    const res = await request(app).post('/api/emissions')
      .send({ monitoring_point_id: 1, pollutant: 'dust', value: -5 });
    expect(res.status).toBe(400);
  });

  test('监测点不存在返回 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // 监测点查询
    const res = await request(app).post('/api/emissions')
      .send({ monitoring_point_id: 999, pollutant: 'dust', value: 10 });
    expect(res.status).toBe(404);
  });

  test('正常数据入库返回 200', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // 监测点存在
    db.withTransaction.mockResolvedValueOnce({ exceeded: false, emissionId: 1 });
    const res = await request(app).post('/api/emissions')
      .send({ monitoring_point_id: 1, pollutant: 'dust', value: 10 });
    expect(res.status).toBe(200);
    expect(res.body.exceeded).toBe(false);
  });

  test('超标数据触发告警返回 201', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    db.withTransaction.mockResolvedValueOnce({ exceeded: true, emissionId: 2, groupId: 3, eventId: null });
    const res = await request(app).post('/api/emissions')
      .send({ monitoring_point_id: 1, pollutant: 'nox', value: 500 });
    expect(res.status).toBe(201);
    expect(res.body.groupId).toBe(3);
  });
});

describe('GET /api/alarms/groups 告警组列表', () => {
  test('返回分页结构', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ c: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, pollutant: 'nox', alarm_count: 5 }] });
    const res = await request(app).get('/api/alarms/groups?status=active');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/events/:id 事件详情', () => {
  test('事件不存在返回 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/events/42');
    expect(res.status).toBe(404);
  });

  test('返回事件、处置记录、告警组与关联设备', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'processing', alarm_group_id: 2, monitoring_point_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 10, action: 'claim' }] })
      .mockResolvedValueOnce({ rows: [{ id: 2, alarm_count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 5, name: '1#回转窑', status: 'running' }] });
    const res = await request(app).get('/api/events/1');
    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(1);
    expect(res.body.alarmGroup.alarm_count).toBe(3);
    expect(res.body.equipment[0].name).toBe('1#回转窑');
  });
});

describe('POST /api/events/:id/handle 事件处置', () => {
  test('缺少 action 返回 400', async () => {
    const res = await request(app).post('/api/events/1/handle').send({ operator: '张工' });
    expect(res.status).toBe(400);
  });

  test('处置成功返回更新后事件', async () => {
    db.withTransaction.mockResolvedValueOnce({ id: 1, status: 'processing' });
    const res = await request(app).post('/api/events/1/handle')
      .send({ action: 'claim', operator: '张工' });
    expect(res.status).toBe(200);
    expect(res.body.event.status).toBe('processing');
  });

  test('业务错误按状态码透传', async () => {
    db.withTransaction.mockRejectedValueOnce(Object.assign(new Error('事件当前状态为 resolved，不能执行 claim'), { status: 409 }));
    const res = await request(app).post('/api/events/1/handle')
      .send({ action: 'claim', operator: '张工' });
    expect(res.status).toBe(409);
  });
});

describe('PUT /api/equipment/:id/status 设备状态联动', () => {
  test('缺少 status 返回 400', async () => {
    const res = await request(app).put('/api/equipment/1/status').send({});
    expect(res.status).toBe(400);
  });

  test('转入检修状态并关闭活动告警组', async () => {
    db.withTransaction.mockResolvedValueOnce({
      equipment: { id: 1, status: 'maintenance' },
      closedGroups: [3, 4],
    });
    const res = await request(app).put('/api/equipment/1/status').send({ status: 'maintenance' });
    expect(res.status).toBe(200);
    expect(res.body.closedGroups).toEqual([3, 4]);
  });
});
