<script setup>
import { ref, computed, watch, inject } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';
import { usePolling } from '../composables/usePolling.js';
import {
  POLLUTANT_MAP,
  EVENT_STATUS,
  SEVERITY,
  EQUIPMENT_STATUS,
} from '../constants.js';
import StatusBadge from '../components/StatusBadge.vue';
import { formatNumber, formatShortTime } from '../utils/format.js';

const router = useRouter();
const notify = inject('notify');

const events = ref([]);
const equipment = ref([]);
const statusFilter = ref('');
const equipmentFilter = ref('');

const tabs = [
  { value: '', label: '全部' },
  { value: 'open', label: '待派单' },
  { value: 'dispatched', label: '已派单' },
  { value: 'handling', label: '处置中' },
  { value: 'resolved', label: '已处置' },
  { value: 'closed', label: '已归档' },
];

async function load() {
  const [list, eq] = await Promise.all([
    api.getEvents({
      status: statusFilter.value || undefined,
      equipmentId: equipmentFilter.value || undefined,
      limit: 200,
    }),
    equipment.value.length ? Promise.resolve(equipment.value) : api.getEquipment(),
  ]);
  events.value = list;
  equipment.value = eq;
}

const { loading, reload } = usePolling(load, 8000);

watch([statusFilter, equipmentFilter], () => reload());

// 快捷流转（列表页直接派单/开始处置）
const acting = ref(false);
async function quickTransition(ev, toStatus) {
  acting.value = true;
  try {
    await api.transitionEvent(ev.id, {
      toStatus,
      actor: '值班员',
      note: toStatus === 'dispatched' ? '列表页快捷派单' : '列表页快捷开始处置',
    });
    notify('操作成功');
    await reload();
  } catch (err) {
    notify(err.message, 'error');
  } finally {
    acting.value = false;
  }
}

const counts = computed(() => {
  const c = {};
  for (const ev of events.value) c[ev.status] = (c[ev.status] || 0) + 1;
  return c;
});
</script>

<template>
  <h2 class="page-title">超标事件处置</h2>

  <div class="card" style="margin-bottom:14px">
    <div class="toolbar" style="margin-bottom:0">
      <div class="tabs">
        <button
          v-for="t in tabs"
          :key="t.value"
          class="tab"
          :class="{ on: statusFilter === t.value }"
          @click="statusFilter = t.value"
        >
          {{ t.label }}
          <span v-if="counts[t.value]" class="tab-count">{{ counts[t.value] }}</span>
        </button>
      </div>
      <label>
        监测点
        <select v-model="equipmentFilter">
          <option value="">全部设备</option>
          <option v-for="e in equipment" :key="e.id" :value="String(e.id)">
            {{ e.name }}
          </option>
        </select>
      </label>
      <button class="btn btn-sm" @click="reload" :disabled="loading">刷新</button>
    </div>
  </div>

  <div class="card">
    <table class="data">
      <thead>
        <tr>
          <th>事件</th>
          <th>设备 / 污染物</th>
          <th>严重度 / 峰值</th>
          <th>设备状态</th>
          <th>处置状态</th>
          <th>负责人</th>
          <th>发起时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="ev in events" :key="ev.id">
          <td><span class="strong">#{{ ev.id }}</span></td>
          <td>
            <div class="strong">{{ ev.equipment_name }}</div>
            <div class="muted" style="font-size:12px">{{ ev.equipment_code }}</div>
          </td>
          <td>
            <StatusBadge :map="SEVERITY" :value="ev.severity" />
            <div class="danger-text" style="margin-top:4px">{{ formatNumber(ev.peak_value) }}</div>
          </td>
          <td><StatusBadge :map="EQUIPMENT_STATUS" :value="ev.equipment_status" /></td>
          <td><StatusBadge :map="EVENT_STATUS" :value="ev.status" /></td>
          <td>{{ ev.handler || '—' }}</td>
          <td class="muted" style="font-size:12px">{{ formatShortTime(ev.started_at) }}</td>
          <td>
            <button class="btn btn-sm" @click="router.push(`/events/${ev.id}`)">
              处置详情
            </button>
            <button
              v-if="ev.status === 'open'"
              class="btn btn-sm btn-primary"
              style="margin-left:4px"
              :disabled="acting"
              @click="quickTransition(ev, 'dispatched')"
            >派单</button>
            <button
              v-if="ev.status === 'dispatched'"
              class="btn btn-sm btn-primary"
              style="margin-left:4px"
              :disabled="acting"
              @click="quickTransition(ev, 'handling')"
            >开始处置</button>
          </td>
        </tr>
        <tr v-if="!events.length">
          <td colspan="8" class="muted" style="text-align:center;padding:30px">暂无事件</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.tab {
  border: 1px solid var(--border);
  background: #fff;
  padding: 5px 12px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 13px;
}
.tab.on { background: var(--primary); color: #fff; border-color: var(--primary); }
.tab-count {
  display: inline-block;
  margin-left: 4px;
  background: rgba(0, 0, 0, .08);
  border-radius: 9px;
  padding: 0 7px;
  font-size: 11px;
}
.tab.on .tab-count { background: rgba(255, 255, 255, .25); }
label { display:flex; align-items:center; gap:6px; font-size:13px; color:var(--text-muted); }
</style>
