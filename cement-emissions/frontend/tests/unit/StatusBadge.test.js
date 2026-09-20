import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import StatusBadge from '../../src/components/StatusBadge.vue';
import { EVENT_STATUS, SEVERITY } from '../../src/constants.js';

describe('StatusBadge 组件', () => {
  it('渲染中文状态文案与颜色样式', () => {
    const wrapper = mount(StatusBadge, {
      props: { map: EVENT_STATUS, value: 'handling' },
    });
    expect(wrapper.text()).toBe('处置中');
    const style = wrapper.attributes('style');
    expect(style).toContain('rgb(37, 99, 235)');
  });

  it('严重告警为红色', () => {
    const wrapper = mount(StatusBadge, {
      props: { map: SEVERITY, value: 'critical' },
    });
    expect(wrapper.text()).toBe('严重');
    expect(wrapper.attributes('style')).toContain('rgb(220, 38, 38)');
  });

  it('未知状态降级显示原始值', () => {
    const wrapper = mount(StatusBadge, {
      props: { map: EVENT_STATUS, value: 'unknown' },
    });
    expect(wrapper.text()).toBe('unknown');
  });
});
