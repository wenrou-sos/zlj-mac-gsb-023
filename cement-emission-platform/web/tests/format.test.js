import { describe, it, expect } from 'vitest';
import {
  exceedRate, availableActions, groupMergeSummary, formatTime,
  POLLUTANT_META, SEVERITY_META,
} from '../src/utils/format';

describe('exceedRate 超标率计算', () => {
  it('计算超出限值的百分比', () => {
    expect(exceedRate(120, 100)).toBe(20);
    expect(exceedRate(150, 100)).toBe(50);
  });
  it('未超标返回非正值', () => {
    expect(exceedRate(80, 100)).toBe(-20);
  });
  it('限值非法时返回 0', () => {
    expect(exceedRate(100, 0)).toBe(0);
    expect(exceedRate(100, null)).toBe(0);
  });
});

describe('availableActions 事件处置动作', () => {
  it('待处置仅可认领', () => {
    expect(availableActions('pending').map((a) => a.action)).toEqual(['claim']);
  });
  it('处置中可排查、措施、办结', () => {
    expect(availableActions('processing').map((a) => a.action))
      .toEqual(['investigate', 'measure', 'resolve']);
  });
  it('已办结无可执行动作', () => {
    expect(availableActions('resolved')).toEqual([]);
  });
});

describe('groupMergeSummary 合并摘要', () => {
  it('展示合并条数与峰值', () => {
    expect(groupMergeSummary({ alarm_count: 5, max_value: 420 }))
      .toBe('5 条告警合并 · 峰值 420 mg/m³');
  });
  it('空组返回空串', () => {
    expect(groupMergeSummary(null)).toBe('');
  });
});

describe('formatTime 时间格式化', () => {
  it('格式化为 YYYY-MM-DD HH:mm', () => {
    const d = new Date(2026, 8, 19, 9, 5);
    expect(formatTime(d.toISOString())).toBe('2026-09-19 09:05');
  });
  it('空值返回占位符', () => {
    expect(formatTime(null)).toBe('-');
  });
});

describe('领域元数据完整性', () => {
  it('三种污染物均有名称与单位', () => {
    for (const code of ['dust', 'nox', 'so2']) {
      expect(POLLUTANT_META[code].name).toBeTruthy();
      expect(POLLUTANT_META[code].unit).toBe('mg/m³');
    }
  });
  it('告警级别元数据齐全', () => {
    expect(Object.keys(SEVERITY_META)).toEqual(['warning', 'major', 'critical']);
  });
});
