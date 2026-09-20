<template>
  <div>
    <div class="card">
      <h3>超标事件处置</h3>
      <div class="filters">
        <button v-for="t in tabs" :key="t.value" class="btn"
                :class="{ ghost: statusFilter !== t.value }"
                @click="statusFilter = t.value; load()">
          {{ t.label }}
        </button>
      </div>
      <div v-if="error" class="error-banner">{{ error }}</div>
      <table>
        <thead>
          <tr>
            <th>事件编号</th><th>监测点</th><th>污染物</th><th>峰值/限值</th>
            <th>超标率</th><th>开始时间</th><th>状态</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in events" :key="e.id" :class="{ selected: current?.event.id === e.id }">
            <td>{{ e.event_no }}</td>
            <td>{{ e.point_name }}</td>
            <td>{{ pollutantMeta[e.pollutant]?.name || e.pollutant }}</td>
            <td>{{ e.max_value }} / {{ e.limit_value }}</td>
            <td :style="{ color: '#f56c6c' }">+{{ exceedRate(e.max_value, e.limit_value) }}%</td>
            <td>{{ formatTime(e.started_at) }}</td>
            <td><span class="tag" :style="{ background: statusColor(e.status) }">{{ statusLabel(e.status) }}</span></td>
            <td><button class="btn ghost" @click="openDetail(e)">处置</button></td>
          </tr>
          <tr v-if="!events.length"><td colspan="8" class="muted" style="text-align:center">暂无事件</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 事件详情与处置 -->
    <div v-if="current" class="card detail-panel">
      <h3>事件详情：{{ current.event.event_no }}</h3>
      <div class="detail-grid">
        <div>
          <p><b>监测点：</b>{{ current.event.point_name }}</p>
          <p><b>污染物：</b>{{ pollutantMeta[current.event.pollutant]?.name }}</p>
          <p><b>峰值：</b>{{ current.event.max_value }} mg/m³（限值 {{ current.event.limit_value }}）</p>
          <p><b>状态：</b><span class="tag" :style="{ background: statusColor(current.event.status) }">{{ statusLabel(current.event.status) }}</span></p>
        </div>
        <div>
          <p><b>关联告警组：</b>#{{ current.alarmGroup?.id }}（{{ current.alarmGroup?.alarm_count }} 条告警合并）</p>
          <p><b>关联设备状态：</b></p>
          <ul class="equip-list">
            <li v-for="eq in current.equipment" :key="eq.id">
              {{ eq.name }}
              <span class="tag" :style="{ background: equipColor(eq.status) }">{{ equipLabel(eq.status) }}</span>
            </li>
          </ul>
        </div>
      </div>

      <h4>处置记录</h4>
      <div class="timeline">
        <div v-for="r in current.records" :key="r.id" class="timeline-item">
          <span class="dot"></span>
          <div>
            <b>{{ actionLabel(r.action) }}</b> · {{ r.operator }}
            <span class="muted">{{ formatTime(r.created_at) }}</span>
            <p v-if="r.note" class="note">{{ r.note }}</p>
          </div>
        </div>
        <p v-if="!current.records.length" class="muted">暂无处置记录</p>
      </div>

      <div v-if="actions.length" class="handle-form">
        <select v-model="form.action">
          <option v-for="a in actions" :key="a.action" :value="a.action">{{ a.label }}</option>
        </select>
        <input v-model="form.operator" placeholder="处置人" />
        <input v-model="form.note" placeholder="处置说明（可选）" style="flex:1" />
        <button class="btn" @click="submitHandle">提交</button>
      </div>
      <p v-else class="muted">事件已办结，无需进一步处置。</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { getEvents, getEventDetail, handleEvent } from '../api';
import {
  POLLUTANT_META, EVENT_STATUS_META, EQUIPMENT_STATUS_META, HANDLE_ACTIONS,
  exceedRate, availableActions, formatTime,
} from '../utils/format';

const events = ref([]);
const current = ref(null);
const statusFilter = ref('');
const error = ref('');
const form = ref({ action: '', operator: '', note: '' });
const pollutantMeta = POLLUTANT_META;

const tabs = [
  { value: '', label: '全部' },
  { value: 'pending', label: '待处置' },
  { value: 'processing', label: '处置中' },
  { value: 'resolved', label: '已办结' },
];

const statusColor = (s) => EVENT_STATUS_META[s]?.color || '#909399';
const statusLabel = (s) => EVENT_STATUS_META[s]?.label || s;
const equipColor = (s) => EQUIPMENT_STATUS_META[s]?.color || '#909399';
const equipLabel = (s) => EQUIPMENT_STATUS_META[s]?.label || s;
const actionLabel = (a) => HANDLE_ACTIONS.find((x) => x.action === a)?.label || a;

const actions = computed(() => {
  const list = current.value ? availableActions(current.value.event.status) : [];
  if (list.length && !list.some((a) => a.action === form.value.action)) {
    form.value.action = list[0].action;
  }
  return list;
});

async function load() {
  try {
    const res = await getEvents(statusFilter.value ? { status: statusFilter.value } : {});
    events.value = res.data;
    error.value = '';
  } catch (e) { error.value = e.message; }
}

async function openDetail(e) {
  current.value = await getEventDetail(e.id);
}

async function submitHandle() {
  try {
    await handleEvent(current.value.event.id, { ...form.value });
    form.value.note = '';
    await openDetail(current.value.event);
    await load();
  } catch (e) { error.value = e.message; }
}

onMounted(load);
</script>

<style scoped>
tr.selected td { background: #ecf5ff; }
.detail-panel { border-left: 4px solid #409eff; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
.detail-grid p { margin: 6px 0; font-size: 13px; }
.equip-list { list-style: none; }
.equip-list li { margin: 4px 0; font-size: 13px; }
h4 { margin: 12px 0 8px; font-size: 14px; color: #606266; }
.timeline-item { display: flex; gap: 10px; margin-bottom: 10px; font-size: 13px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #409eff; margin-top: 6px; flex-shrink: 0; }
.note { color: #606266; margin-top: 2px; }
.handle-form { display: flex; gap: 10px; margin-top: 14px; }
</style>
