import { describe, it, expect } from 'vitest';
import {
  evaluateLevel,
  isSuppressedByEquipment,
  shouldMerge,
  mergeIntoGroup,
  shouldAutoResolve,
  escalateSeverity,
} from '../../src/services/alarm-engine.js';

const threshold = { warning: 25, critical: 30 };

describe('evaluateLevel 限值判定', () => {
  it('低于预警限值返回 ok', () => {
    expect(evaluateLevel(10, threshold)).toBe('ok');
    expect(evaluateLevel(24.999, threshold)).toBe('ok');
  });

  it('达到预警但低于严重限值返回 warning（边界含等号）', () => {
    expect(evaluateLevel(25, threshold)).toBe('warning');
    expect(evaluateLevel(29.9, threshold)).toBe('warning');
  });

  it('达到严重限值返回 critical', () => {
    expect(evaluateLevel(30, threshold)).toBe('critical');
    expect(evaluateLevel(99, threshold)).toBe('critical');
  });

  it('缺省限值视为 ok', () => {
    expect(evaluateLevel(999, null)).toBe('ok');
  });

  it('限值为字符串数字时也能正确比较', () => {
    expect(evaluateLevel('28', { warning: '25', critical: '30' })).toBe('warning');
  });
});

describe('isSuppressedByEquipment 设备状态关联', () => {
  it('停机与检修状态应抑制告警', () => {
    expect(isSuppressedByEquipment('stopped')).toBe(true);
    expect(isSuppressedByEquipment('maintenance')).toBe(true);
  });
  it('运行与故障状态不抑制', () => {
    expect(isSuppressedByEquipment('running')).toBe(false);
    expect(isSuppressedByEquipment('fault')).toBe(false);
  });
});

describe('shouldMerge 告警合并窗口', () => {
  const base = new Date('2026-09-19T10:00:00Z');
  const activeGroup = { status: 'active', last_alarm_at: base };
  const windowMs = 10 * 60 * 1000;

  it('窗口内重复告警合并', () => {
    expect(
      shouldMerge(activeGroup, new Date(base.getTime() + 9 * 60000), windowMs),
    ).toBe(true);
  });

  it('恰好窗口边界仍合并', () => {
    expect(shouldMerge(activeGroup, new Date(base.getTime() + 10 * 60000), windowMs))
      .toBe(true);
  });

  it('超出窗口不合并', () => {
    expect(
      shouldMerge(activeGroup, new Date(base.getTime() + 11 * 60000), windowMs),
    ).toBe(false);
  });

  it('没有已存在组时不合并', () => {
    expect(shouldMerge(null, base, windowMs)).toBe(false);
  });

  it.each(['resolved', 'suppressed'])(
    '%s 状态的组不再合并',
    (status) => {
      expect(
        shouldMerge({ status, last_alarm_at: base }, base, windowMs),
      ).toBe(false);
    },
  );

  it('已确认(acknowledged)的组在窗口内仍继续合并', () => {
    expect(
      shouldMerge(
        { status: 'acknowledged', last_alarm_at: base },
        new Date(base.getTime() + 1000),
        windowMs,
      ),
    ).toBe(true);
  });
});

describe('mergeIntoGroup 合并聚合', () => {
  const base = new Date('2026-09-19T10:00:00Z');
  const group = {
    id: 1,
    status: 'active',
    severity: 'warning',
    peak_value: 26,
    latest_value: 26,
    last_alarm_at: base,
    alarm_count: 1,
  };

  it('累计计数、刷新最新值与时间、更新峰值', () => {
    const next = mergeIntoGroup(group, 35, 'critical', new Date(base.getTime() + 60000));
    expect(next.alarm_count).toBe(2);
    expect(next.latest_value).toBe(35);
    expect(next.peak_value).toBe(35);
    expect(next.last_alarm_at).toEqual(new Date(base.getTime() + 60000));
  });

  it('峰值不会因较低读数下降', () => {
    const next = mergeIntoGroup(group, 27, 'warning', new Date(base.getTime() + 60000));
    expect(next.peak_value).toBe(27);
    const next2 = mergeIntoGroup(next, 25.5, 'warning', new Date(base.getTime() + 120000));
    expect(next2.peak_value).toBe(27);
    expect(next2.alarm_count).toBe(3);
  });

  it('严重度只升不降', () => {
    const toCritical = mergeIntoGroup(group, 31, 'critical', new Date(base.getTime() + 60000));
    expect(toCritical.severity).toBe('critical');
    const back = mergeIntoGroup(toCritical, 26, 'warning', new Date(base.getTime() + 120000));
    expect(back.severity).toBe('critical');
  });
});

describe('shouldAutoResolve 自动消解', () => {
  it('活跃组可被之后的正常读数消解', () => {
    const g = {
      status: 'active',
      last_alarm_at: new Date('2026-09-19T10:00:00Z'),
    };
    expect(shouldAutoResolve(g, new Date('2026-09-19T10:05:00Z'))).toBe(true);
  });
  it('已消解/抑制的组不重复消解', () => {
    const g = {
      status: 'resolved',
      last_alarm_at: new Date('2026-09-19T10:00:00Z'),
    };
    expect(shouldAutoResolve(g, new Date('2026-09-19T10:05:00Z'))).toBe(false);
  });
  it('无开启组时不消解', () => {
    expect(shouldAutoResolve(null, new Date())).toBe(false);
  });
});

describe('escalateSeverity', () => {
  it('任一为严重即为严重', () => {
    expect(escalateSeverity('warning', 'critical')).toBe('critical');
    expect(escalateSeverity('critical', 'warning')).toBe('critical');
  });
  it('两者皆预警仍为预警', () => {
    expect(escalateSeverity('warning', 'warning')).toBe('warning');
  });
});
