'use strict';

const { nextStatus, handleEvent } = require('../src/services/eventService');

describe('nextStatus 事件处置状态机', () => {
  test('pending 可认领为 processing', () => {
    expect(nextStatus('pending', 'claim')).toBe('processing');
  });
  test('processing 可追加排查/措施并保持 processing', () => {
    expect(nextStatus('processing', 'investigate')).toBe('processing');
    expect(nextStatus('processing', 'measure')).toBe('processing');
  });
  test('processing 可办结为 resolved', () => {
    expect(nextStatus('processing', 'resolve')).toBe('resolved');
  });
  test('pending 不能直接办结', () => {
    expect(() => nextStatus('pending', 'resolve')).toThrow(/不能执行/);
  });
  test('resolved 不能再处置', () => {
    expect(() => nextStatus('resolved', 'claim')).toThrow(/不能执行/);
  });
  test('非法动作报 400', () => {
    expect(() => nextStatus('pending', 'delete')).toThrow(/不支持的处置动作/);
  });
});

function fakeClient(rows) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT \* FROM exceedance_events/.test(sql)) return { rows };
      if (/UPDATE exceedance_events/.test(sql)) {
        return { rows: [{ ...rows[0], status: params[1] }] };
      }
      return { rows: [] };
    }),
  };
}

describe('handleEvent 处置流程', () => {
  test('完整流程：认领 → 排查 → 办结', async () => {
    const event = { id: 1, status: 'pending' };
    let client = fakeClient([event]);
    const claimed = await handleEvent(client, 1, { action: 'claim', operator: '张工' });
    expect(claimed.status).toBe('processing');

    client = fakeClient([{ ...event, status: 'processing' }]);
    await handleEvent(client, 1, { action: 'investigate', operator: '张工', note: '喷氨量不足' });
    const resolved = await handleEvent(client, 1, { action: 'resolve', operator: '张工', note: '已恢复' });
    expect(resolved.status).toBe('resolved');
    expect(client.calls.filter((c) => /INSERT INTO handling_records/.test(c.sql)).length).toBe(2);
  });

  test('事件不存在返回 404', async () => {
    const client = fakeClient([]);
    await expect(handleEvent(client, 99, { action: 'claim', operator: '张工' }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('处置人为空返回 400', async () => {
    const client = fakeClient([{ id: 1, status: 'pending' }]);
    await expect(handleEvent(client, 1, { action: 'claim', operator: '  ' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('非法流转返回 409', async () => {
    const client = fakeClient([{ id: 1, status: 'pending' }]);
    await expect(handleEvent(client, 1, { action: 'resolve', operator: '张工' }))
      .rejects.toMatchObject({ status: 409 });
  });
});
