import { describe, it, expect } from 'vitest';
import {
  canTransition,
  transition,
  actionFor,
  requireResolution,
  EVENT_TRANSITIONS,
} from '../../src/services/event-machine.js';

describe('事件处置状态机', () => {
  it('定义了完整的处置链路', () => {
    expect(EVENT_TRANSITIONS.open).toContain('dispatched');
    expect(EVENT_TRANSITIONS.dispatched).toContain('handling');
    expect(EVENT_TRANSITIONS.handling).toContain('resolved');
    expect(EVENT_TRANSITIONS.resolved).toContain('closed');
    // 允许跳步：现场自行处置
    expect(EVENT_TRANSITIONS.open).toContain('handling');
    // 处置完成后可回退补充处置
    expect(EVENT_TRANSITIONS.resolved).toContain('handling');
  });

  it('closed 为终态', () => {
    expect(EVENT_TRANSITIONS.closed).toEqual([]);
  });

  it('canTransition 判定合法流转', () => {
    expect(canTransition('open', 'dispatched')).toBe(true);
    expect(canTransition('open', 'resolved')).toBe(false);
    expect(canTransition('handling', 'closed')).toBe(true);
  });

  it('transition 返回目标状态与对应动作', () => {
    expect(transition({ status: 'open' }, 'dispatched')).toEqual({
      status: 'dispatched',
      action: 'dispatch',
    });
    expect(transition({ status: 'handling' }, 'resolved')).toEqual({
      status: 'resolved',
      action: 'resolve',
    });
  });

  it('非法流转抛错', () => {
    expect(() => transition({ status: 'open' }, 'resolved')).toThrow(
      /不允许从/,
    );
  });

  it('重复流转到当前状态抛错', () => {
    expect(() => transition({ status: 'open' }, 'open')).toThrow(/无需重复操作/);
  });

  it('事件不存在时抛错', () => {
    expect(() => transition(null, 'handling')).toThrow('事件不存在');
  });

  it('actionFor 映射', () => {
    expect(actionFor('open', 'dispatched')).toBe('dispatch');
    expect(actionFor('dispatched', 'handling')).toBe('handle');
    expect(actionFor('handling', 'resolved')).toBe('resolve');
    expect(actionFor('resolved', 'closed')).toBe('close');
  });

  it('resolve 必须填写处置措施说明', () => {
    expect(() => requireResolution('resolved', '')).toThrow(/处置措施/);
    expect(() => requireResolution('resolved', '   ')).toThrow(/处置措施/);
    expect(() => requireResolution('resolved', undefined)).toThrow(/处置措施/);
  });

  it('非 resolve 流转不要求说明', () => {
    expect(() => requireResolution('handling', '')).not.toThrow();
    expect(() => requireResolution('resolved', '已更换滤袋')).not.toThrow();
  });
});
