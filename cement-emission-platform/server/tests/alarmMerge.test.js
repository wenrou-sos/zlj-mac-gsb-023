'use strict';

const {
  computeSeverity,
  shouldMerge,
  mergeAlarmIntoGroup,
  isExemptByEquipment,
  shouldCreateEvent,
  processEmissionData,
} = require('../src/services/alarmService');
const config = require('../src/config');

describe('computeSeverity 告警级别判定', () => {
  const limit = 100;
  test('1.0~1.2 倍限值为 warning', () => {
    expect(computeSeverity(100.1, limit)).toBe('warning');
    expect(computeSeverity(119, limit)).toBe('warning');
  });
  test('1.2~1.5 倍限值为 major', () => {
    expect(computeSeverity(120, limit)).toBe('major');
    expect(computeSeverity(149, limit)).toBe('major');
  });
  test('1.5 倍及以上为 critical', () => {
    expect(computeSeverity(150, limit)).toBe('critical');
    expect(computeSeverity(300, limit)).toBe('critical');
  });
});

describe('shouldMerge 告警合并窗口', () => {
  const group = {
    monitoring_point_id: 1,
    pollutant: 'nox',
    status: 'active',
    last_alarm_at: '2026-09-19T10:00:00Z',
  };
  const base = { monitoringPointId: 1, pollutant: 'nox' };

  test('窗口内同点同污染物可合并', () => {
    expect(shouldMerge(group, { ...base, measuredAt: '2026-09-19T10:20:00Z' }, 30)).toBe(true);
  });
  test('超出合并窗口不合并', () => {
    expect(shouldMerge(group, { ...base, measuredAt: '2026-09-19T10:31:00Z' }, 30)).toBe(false);
  });
  test('不同监测点不合并', () => {
    expect(shouldMerge(group, { ...base, monitoringPointId: 2, measuredAt: '2026-09-19T10:05:00Z' }, 30)).toBe(false);
  });
  test('不同污染物不合并', () => {
    expect(shouldMerge(group, { ...base, pollutant: 'so2', measuredAt: '2026-09-19T10:05:00Z' }, 30)).toBe(false);
  });
  test('已关闭的组不合并', () => {
    expect(shouldMerge({ ...group, status: 'closed' }, { ...base, measuredAt: '2026-09-19T10:05:00Z' }, 30)).toBe(false);
  });
});

describe('mergeAlarmIntoGroup 组合并更新', () => {
  test('计数累加、取最大值、级别取高、更新最后告警时间', () => {
    const group = { alarm_count: 2, max_value: 360, severity: 'major' };
    const alarm = { value: 410, severity: 'critical', created_at: '2026-09-19T11:00:00Z' };
    const merged = mergeAlarmIntoGroup(group, alarm);
    expect(merged.alarm_count).toBe(3);
    expect(merged.max_value).toBe(410);
    expect(merged.severity).toBe('critical');
    expect(merged.last_alarm_at).toBe('2026-09-19T11:00:00Z');
  });
  test('低级别告警不降低组级别', () => {
    const group = { alarm_count: 1, max_value: 500, severity: 'critical' };
    const alarm = { value: 330, severity: 'warning', created_at: '2026-09-19T11:00:00Z' };
    expect(mergeAlarmIntoGroup(group, alarm).severity).toBe('critical');
  });
});

describe('设备状态免考核关联', () => {
  test('检修/停运免考核', () => {
    expect(isExemptByEquipment('maintenance')).toBe(true);
    expect(isExemptByEquipment('offline')).toBe(true);
  });
  test('运行/故障不免考核', () => {
    expect(isExemptByEquipment('running')).toBe(false);
    expect(isExemptByEquipment('fault')).toBe(false);
  });
  test('免考核组不生成超标事件', () => {
    expect(shouldCreateEvent({ exempt: true, alarm_count: 10 }, 3)).toBe(false);
    expect(shouldCreateEvent({ exempt: false, alarm_count: 3 }, 3)).toBe(true);
    expect(shouldCreateEvent({ exempt: false, alarm_count: 2 }, 3)).toBe(false);
  });
});

/** 构造一个按 SQL 正则匹配返回结果的假 client */
function fakeClient(handlers) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      for (const h of handlers) {
        if (h.match.test(sql)) {
          const rows = typeof h.rows === 'function' ? h.rows(params) : h.rows;
          return { rows };
        }
      }
      return { rows: [] };
    }),
  };
}

describe('processEmissionData 数据接入与告警联动', () => {
  test('未超标仅入库，不产生告警', async () => {
    const client = fakeClient([
      { match: /INSERT INTO emission_data/, rows: [{ id: 1 }] },
    ]);
    const result = await processEmissionData(client, {
      monitoring_point_id: 1, pollutant: 'dust', value: 10,
    });
    expect(result.exceeded).toBe(false);
    expect(client.calls.some((c) => /INSERT INTO alarms/.test(c.sql))).toBe(false);
  });

  test('超标且无活动组时新建告警组', async () => {
    const group = {
      id: 7, alarm_count: 0, max_value: 25, severity: 'major',
      status: 'active', exempt: false, first_alarm_at: new Date(),
    };
    const client = fakeClient([
      { match: /INSERT INTO emission_data/, rows: [{ id: 1 }] },
      { match: /SELECT status FROM equipment/, rows: [{ status: 'running' }] },
      { match: /SELECT \* FROM alarm_groups/, rows: [] },
      { match: /INSERT INTO alarm_groups/, rows: [group] },
      { match: /INSERT INTO alarms/, rows: [{ id: 100, value: 25, severity: 'major', created_at: new Date() }] },
      { match: /UPDATE alarm_groups/, rows: [{ ...group, alarm_count: 1 }] },
    ]);
    const result = await processEmissionData(client, {
      monitoring_point_id: 1, pollutant: 'dust', value: 25, // 限值 20，1.25x → major
    });
    expect(result.exceeded).toBe(true);
    expect(result.groupId).toBe(7);
    expect(client.calls.some((c) => /INSERT INTO alarm_groups/.test(c.sql))).toBe(true);
  });

  test('窗口内连续超标合并进同一组，达到阈值生成超标事件', async () => {
    const oldThreshold = config.alarm.eventThresholdCount;
    config.alarm.eventThresholdCount = 2; // 第二条告警即触发事件
    const now = new Date();
    const group = {
      id: 9, monitoring_point_id: 1, pollutant: 'nox', status: 'active',
      alarm_count: 1, max_value: 400, severity: 'major', exempt: false,
      first_alarm_at: now, last_alarm_at: now,
    };
    const client = fakeClient([
      { match: /INSERT INTO emission_data/, rows: [{ id: 2 }] },
      { match: /SELECT status FROM equipment/, rows: [{ status: 'running' }] },
      { match: /SELECT \* FROM alarm_groups/, rows: [group] },
      { match: /INSERT INTO alarms/, rows: [{ id: 101, value: 420, severity: 'major', created_at: now }] },
      { match: /UPDATE alarm_groups/, rows: [{ ...group, alarm_count: 2 }] },
      { match: /SELECT id FROM exceedance_events/, rows: [] },
      { match: /INSERT INTO exceedance_events/, rows: [{ id: 55 }] },
    ]);
    const result = await processEmissionData(client, {
      monitoring_point_id: 1, pollutant: 'nox', value: 420, measured_at: now,
    });
    expect(result.groupId).toBe(9);
    expect(result.eventId).toBe(55);
    expect(client.calls.some((c) => /INSERT INTO alarm_groups/.test(c.sql))).toBe(false);
    config.alarm.eventThresholdCount = oldThreshold;
  });

  test('设备检修期间超标标记免考核，不生成事件', async () => {
    const oldThreshold = config.alarm.eventThresholdCount;
    config.alarm.eventThresholdCount = 1;
    const group = {
      id: 11, alarm_count: 0, max_value: 130, severity: 'major',
      status: 'active', exempt: true, first_alarm_at: new Date(),
    };
    const client = fakeClient([
      { match: /INSERT INTO emission_data/, rows: [{ id: 3 }] },
      { match: /SELECT status FROM equipment/, rows: [{ status: 'maintenance' }] },
      { match: /SELECT \* FROM alarm_groups/, rows: [] },
      { match: /INSERT INTO alarm_groups/, rows: [group] },
      { match: /INSERT INTO alarms/, rows: [{ id: 102, value: 130, severity: 'major', created_at: new Date() }] },
      { match: /UPDATE alarm_groups/, rows: [{ ...group, alarm_count: 1 }] },
    ]);
    const result = await processEmissionData(client, {
      monitoring_point_id: 1, pollutant: 'so2', value: 130,
    });
    expect(result.exceeded).toBe(true);
    expect(result.eventId).toBeNull();
    // 建组时写入 exempt=true 与设备状态快照
    const insertGroup = client.calls.find((c) => /INSERT INTO alarm_groups/.test(c.sql));
    expect(insertGroup.params[6]).toBe(true);
    expect(insertGroup.params[7]).toBe('maintenance');
    config.alarm.eventThresholdCount = oldThreshold;
  });

  test('未知污染物抛出 400 业务错误', async () => {
    const client = fakeClient([]);
    await expect(processEmissionData(client, {
      monitoring_point_id: 1, pollutant: 'co2', value: 1,
    })).rejects.toMatchObject({ status: 400 });
  });
});
