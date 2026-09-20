import { describe, it, expect } from 'vitest';
import {
  formatTime,
  formatShortTime,
  formatNumber,
  relativeFromNow,
} from '../../src/utils/format.js';

describe('format 工具函数', () => {
  it('formatNumber 保留指定位数', () => {
    expect(formatNumber(3.14159, 2)).toBe('3.14');
    expect(formatNumber(3.14159, 0)).toBe('3');
    expect(formatNumber('26.5', 1)).toBe('26.5');
  });

  it('空值与非法值返回 —', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
    expect(formatNumber('abc')).toBe('—');
    expect(formatTime(null)).toBe('—');
    expect(formatTime('not-a-date')).toBe('—');
  });

  it('formatTime 输出 YYYY-MM-DD HH:mm:ss', () => {
    const s = formatTime(new Date('2026-09-19T08:05:09Z'));
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('formatShortTime 输出短格式', () => {
    const s = formatShortTime(new Date('2026-09-19T08:05:00Z'));
    expect(s).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('relativeFromNow 相对时间', () => {
    expect(relativeFromNow(new Date())).toBe('刚刚');
    expect(relativeFromNow(new Date(Date.now() - 5 * 60000))).toBe('5 分钟前');
    expect(relativeFromNow(new Date(Date.now() - 3 * 3600000))).toBe('3 小时前');
    expect(relativeFromNow(new Date(Date.now() - 2 * 86400000))).toBe('2 天前');
    expect(relativeFromNow(null)).toBe('—');
  });
});
