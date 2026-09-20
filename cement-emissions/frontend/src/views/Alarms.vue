<script setup>
import { ref, computed, watch, inject } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';
import { usePolling } from '../composables/usePolling.js';
import {
  POLLUTANT_MAP,
  ALARM_STATUS,
  SEVERITY,
  EQUIPMENT_STATUS,
} from '../constants.js';
import StatusBadge from '../components/StatusBadge.vue';
import { formatNumber, formatTime, relativeFromNow } from '../utils/format.js';

const router = useRouter();
const notify = inject('notify');

const groups = ref([]);
const equipment = ref([]);
const statusFilter = ref('');
const equipmentFilter = ref('');
const detail = ref(null);
const loadingDetail = ref(false);

const tabs = [
  { value: '', label: '全部' },
  { value: 'active', label: '未确认' },
  { value: 'acknowledged', label: '已确认' },
  { value: 'resolved', label: '已消解' },
  { value: 'suppressed', label: '已抑制' },
];

async function load() {
  const [list, eq] = await Promise.all([
    api.getAlarms({
      status: statusFilter.value || undefined,
      equipmentId: equipmentFilter.value || undefined,
      limit: 200,
    }),
    equipment.value.length ? Promise.resolve(equipment.value) : api.getEquipment(),
  ]);
  groups.value = list;
  equipment.value = eq;
}

const { loading, reload } = usePolling(load, 8000);

watch([statusFilter, equipmentFilter], () => reload());

async function showDetail(g) {
  loadingDetail.value = true;
  try {
    detail.value = await api.getAlarm(g.id);
  } finally {
    loadingDetail.value = false;
  }
}

async function acknowledge(g) {
  try {
    await api.acknowledgeAlarm(g.id);
    notify(`已确认告警 #${g.id}`);
    await reload();
    if (detail.value?.id === g.id) detail.value = await api.getAlarm(g.id);
  } catch (err) {
    notify(err.message, 'error');
  }
}

const mergedSaved = computed(() =>
  groups.value.reduce((sum, g) => sum + (Number(g.alarm_count) - 1), 0),
);
</script>

<template>
  <h2 class="page-title">告警管理</h2>

  <div class="card" style="margin-bottom:14px">
    <div class="toolbar" style="margin-bottom:0">
      <div class="tabs">
        <button
          v-for="t in tabs"
          :key="t.value"
          class="tab"
          :class="{ on: statusFilter === t.value }"
          @click="statusFilter = t.value"
        >{{ t.label }}</button>
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
      <span class="muted" style="font-size:12px;margin-left:auto">
        当前列表通过合并共减少 <strong class="warning-text">{{ mergedSaved }}</strong> 条重复告警
      </span>
    </div>
  </div>

  <div class="layout-split">
    <div class="card">
      <table class="data">
        <thead>
          <tr>
            <th>严重度</th>
            <th>设备 / 污染物</th>
            <th>峰值</th>
            <th>合并次数</th>
            <th>设备状态</th>
            <th>状态</th>
            <th>最近告警</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="g in groups"
            :key="g.id"
            :class="{ selected: detail?.id === g.id }"
            @click="showDetail(g)"
          >
            <td><StatusBadge :map="SEVERITY" :value="g.severity" /></td>
            <td>
              <div class="strong">{{ g.equipment_name }}</div>
              <div class="muted" style="font-size:12px">
                {{ POLLUTANT_MAP[g.pollutant].label }} · #{{ g.id }}
              </div>
            </td>
            <td><span class="danger-text">{{ formatNumber(g.peak_value) }}</span></td>
            <td>{{ g.alarm_count }}</td>
            <td><StatusBadge :map="EQUIPMENT_STATUS" :value="g.equipment_status" /></td>
            <td><StatusBadge :map="ALARM_STATUS" :value="g.status" /></td>
            <td class="muted" style="font-size:12px">{{ relativeFromNow(g.last_alarm_at) }}</td>
            <td @click.stop>
              <button
                v-if="g.status === 'active'"
                class="btn btn-sm btn-primary"
                @click="acknowledge(g)"
              >确认</button>
              <button
                v-if="g.event_status"
                class="btn btn-sm"
                @click="router.push(`/events/${g.event_id}`)"
              >处置事件</button>
            </td>
          </tr>
          <tr v-if="!groups.length">
            <td colspan="8" class="muted" style="text-align:center;padding:30px">
              暂无告警记录
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 告警组详情：合并明细 -->
    <div class="card detail-panel">
      <h3>合并告警明细</h3>
      <div v-if="loadingDetail" class="muted">加载中…</div>
      <div v-else-if="!detail" class="muted empty-hint">
        点击左侧告警查看该组合并的全部超标记录
      </div>
      <div v-else>
        <div class="detail-head">
          <div>
            <StatusBadge :map="SEVERITY" :value="detail.severity" />
            <StatusBadge :map="ALARM_STATUS" :value="detail.status" class="ml" />
          </div>
          <div class="muted" style="font-size:12px;margin-top:6px">
            {{ detail.equipment_name }} · {{ POLLUTANT_MAP[detail.pollutant].label }}
          </div>
        </div>
        <div v-if="detail.suppression_reason" class="suppress-note">
          抑制原因：{{ detail.suppression_reason }}
        </div>
        <dl class="kv">
          <div><dt>首次告警</dt><dd>{{ formatTime(detail.first_alarm_at) }}</dd></div>
          <div><dt>最近告警</dt><dd>{{ formatTime(detail.last_alarm_at) }}</dd></div>
          <div><dt>峰值</dt><dd class="danger-text">{{ formatNumber(detail.peak_value) }}</dd></div>
          <div><dt>最新值</dt><dd>{{ formatNumber(detail.latest_value) }}</dd></div>
          <div><dt>合并告警数</dt><dd>{{ detail.alarm_count }}</dd></div>
        </dl>
        <div class="alarm-log">
          <div v-for="a in detail.alarms" :key="a.id" class="log-item">
            <div>
              <StatusBadge :map="SEVERITY" :value="a.level" />
              <span class="strong" style="margin-left:6px">{{ formatNumber(a.value) }}</span>
              <span class="muted" style="font-size:12px"> / 限值 {{ a.limit_value }}</span>
            </div>
            <div class="muted" style="font-size:12px">{{ formatTime(a.created_at) }}</div>
          </div>
        </div>
        <div v-if="detail.status === 'active'" style="margin-top:12px">
          <button class="btn btn-primary" @click="acknowledge(detail)">确认告警</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tabs { display: flex; gap: 4px; }
.tab {
  border: 1px solid var(--border);
  background: #fff;
  padding: 5px 14px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 13px;
}
.tab.on { background: var(--primary); color: #fff; border-color: var(--primary); }
label { display:flex; align-items:center; gap:6px; font-size:13px; color:var(--text-muted); }
.layout-split { display: grid; grid-template-columns: 1fr 360px; gap: 14px; align-items: start; }
tr.selected { background: #f0f9ff; }
tr.selected td:first-child { box-shadow: inset 3px 0 0 var(--primary); }
.detail-panel { position: sticky; top: 14px; }
.empty-hint { padding: 40px 0; text-align: center; }
.ml { margin-left: 6px; }
.suppress-note {
  margin: 10px 0;
  padding: 8px 10px;
  background: #f3f4f6;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-muted);
}
.kv { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin: 12px 0; }
.kv dt { font-size: 12px; color: var(--text-muted); }
.kv dd { margin: 2px 0 0; font-weight: 600; }
.alarm-log { max-height: 320px; overflow-y: auto; border-top: 1px solid var(--border); }
.log-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 2px; border-bottom: 1px solid var(--border);
}
</style>
