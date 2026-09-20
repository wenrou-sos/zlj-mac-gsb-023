import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent } from 'vue';

vi.mock('../../src/api/client.js', () => ({
  api: {
    getEvents: vi.fn(),
    getEquipment: vi.fn(),
    transitionEvent: vi.fn(),
  },
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: defineComponent({
    name: 'RouterLink',
    props: ['to'],
    template: '<a><slot /></a>',
  }),
}));

import { api } from '../../src/api/client.js';
import Events from '../../src/views/Events.vue';

const EQUIPMENT = [
  { id: 1, code: 'KILN-01', name: '1#回转窑窑尾' },
  { id: 2, code: 'MILL-01', name: '1#水泥磨' },
];

const EVENTS = [
  {
    id: 101, equipment_id: 1, equipment_code: 'KILN-01', equipment_name: '1#回转窑窑尾',
    equipment_status: 'running', pollutant: 'dust', severity: 'critical',
    status: 'open', peak_value: 35.2, handler: null,
    started_at: new Date().toISOString(),
  },
  {
    id: 102, equipment_id: 2, equipment_code: 'MILL-01', equipment_name: '1#水泥磨',
    equipment_status: 'maintenance', pollutant: 'so2', severity: 'warning',
    status: 'dispatched', peak_value: 185, handler: '张工',
    started_at: new Date().toISOString(),
  },
  {
    id: 103, equipment_id: 1, equipment_code: 'KILN-01', equipment_name: '1#回转窑窑尾',
    equipment_status: 'running', pollutant: 'nox', severity: 'warning',
    status: 'closed', peak_value: 300, handler: '李工',
    started_at: new Date().toISOString(),
  },
];

async function mountPage() {
  const wrapper = mount(Events, {
    global: {
      provide: { notify: vi.fn() },
    },
  });
  await flushPromises();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getEquipment.mockResolvedValue(EQUIPMENT);
  api.getEvents.mockImplementation((params = {}) =>
    Promise.resolve(
      params.status ? EVENTS.filter((e) => e.status === params.status) : [...EVENTS],
    ),
  );
  api.transitionEvent.mockResolvedValue({ ...EVENTS[0], status: 'dispatched' });
});

describe('Events 事件列表页', () => {
  it('加载并渲染全部事件与状态徽标', async () => {
    const wrapper = await mountPage();
    const rows = wrapper.findAll('table.data tbody tr');
    expect(rows).toHaveLength(3);
    expect(wrapper.text()).toContain('1#回转窑窑尾');
    expect(wrapper.text()).toContain('严重');
    expect(wrapper.text()).toContain('待派单');
    // 未指派负责人显示为破折号
    expect(wrapper.find('table.data tbody tr').text()).toContain('—');
  });

  it('未指派的 open 事件显示「派单」按钮，closed 事件无操作按钮', async () => {
    const wrapper = await mountPage();
    const dispatchButtons = wrapper.findAll('table.data tbody button.btn-primary');
    // open 事件有派单按钮，dispatched 事件有开始处置按钮（均为 btn-primary）
    const labels = dispatchButtons.map((b) => b.text());
    expect(labels).toContain('派单');
    expect(labels).toContain('开始处置');
    // closed 事件所在行只有「处置详情」
    const rows = wrapper.findAll('table.data tbody tr');
    const closedRow = rows.find((r) => r.text().includes('#103'));
    expect(closedRow.text()).not.toContain('派单');
    expect(closedRow.text()).not.toContain('开始处置');
  });

  it('点击状态标签按状态过滤', async () => {
    const wrapper = await mountPage();
    const tabs = wrapper.findAll('.tab');
    const closedTab = tabs.find((t) => t.text().includes('已归档'));
    await closedTab.trigger('click');
    await flushPromises();
    expect(api.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'closed' }),
    );
    expect(wrapper.findAll('table.data tbody tr')).toHaveLength(1);
  });

  it('设备下拉过滤带 equipmentId 参数', async () => {
    const wrapper = await mountPage();
    // 页面中唯一的 select 即设备过滤下拉
    const select = wrapper.findAll('select')[0];
    await select.setValue('1');
    await flushPromises();
    expect(api.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ equipmentId: '1' }),
    );
  });

  it('快捷派单调用流转接口并刷新列表', async () => {
    const wrapper = await mountPage();
    const btn = wrapper.findAll('button').find((b) => b.text() === '派单');
    await btn.trigger('click');
    await flushPromises();
    expect(api.transitionEvent).toHaveBeenCalledWith(101, expect.objectContaining({
      toStatus: 'dispatched',
    }));
  });
});
