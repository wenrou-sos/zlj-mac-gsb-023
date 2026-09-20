import { describe, it, expect } from 'vitest';
import {
  POLLUTANTS,
  ALARM_STATUS,
  EVENT_STATUS,
  EVENT_NEXT_ACTIONS,
  EQUIPMENT_STATUS,
} from '../../src/constants.js';

describe('业务常量', () => {
  it('包含粉尘、氮氧化物、二氧化硫三种污染物', () => {
    expect(POLLUTANTS.map((p) => p.key)).toEqual(['dust', 'nox', 'so2']);
    for (const p of POLLUTANTS) {
      expect(p.label).toBeTruthy();
      expect(p.unit).toContain('mg/Nm');
      expect(p.color).toMatch(/^#/);
    }
  });

  it('事件状态与后端状态机保持一致', () => {
    // 后端 EVENT_TRANSITIONS: open/dispatched/handling/resolved/closed
    expect(Object.keys(EVENT_STATUS)).toEqual([
      'open', 'dispatched', 'handling', 'resolved', 'closed',
    ]);

    expect(EVENT_NEXT_ACTIONS.open.map((a) => a.to)).toEqual(
      expect.arrayContaining(['dispatched', 'handling', 'closed']),
    );
    expect(EVENT_NEXT_ACTIONS.dispatched.map((a) => a.to)).toEqual(
      expect.arrayContaining(['handling', 'open']),
    );
    expect(EVENT_NEXT_ACTIONS.handling.map((a) => a.to)).toContain('resolved');
    expect(EVENT_NEXT_ACTIONS.resolved.map((a) => a.to)).toEqual(
      expect.arrayContaining(['closed', 'handling']),
    );
    // closed 终态无后续操作
    expect(EVENT_NEXT_ACTIONS.closed).toEqual([]);
  });

  it('处置完成动作强制要求处置措施', () => {
    const resolveAction = EVENT_NEXT_ACTIONS.handling.find((a) => a.to === 'resolved');
    expect(resolveAction.needResolution).toBe(true);
    expect(resolveAction.needNote).toBe(true);
  });

  it('设备状态含运行/检修/停机/故障，且停机与检修用于告警抑制', () => {
    expect(Object.keys(EQUIPMENT_STATUS)).toEqual([
      'running', 'maintenance', 'stopped', 'fault',
    ]);
    expect(['stopped', 'maintenance'].every((s) => EQUIPMENT_STATUS[s])).toBe(true);
  });

  it('告警状态覆盖 active/acknowledged/resolved/suppressed', () => {
    expect(Object.keys(ALARM_STATUS).sort()).toEqual(
      ['acknowledged', 'active', 'resolved', 'suppressed'].sort(),
    );
  });
});
