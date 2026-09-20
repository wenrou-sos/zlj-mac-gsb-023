<script setup>
import { ref, watch, computed } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api/client.js';
import { usePolling } from '../composables/usePolling.js';
import { POLLUTANTS } from '../constants.js';
import PollutantChart from '../components/PollutantChart.vue';
import { formatNumber } from '../utils/format.js';

const route = useRoute();
const equipment = ref([]);
const thresholds = ref([]);
const series = ref([]);

const equipmentId = ref(
  route.query.equipment ? Number(route.query.equipment) : null,
);
const pollutant = ref('dust');
const hours = ref(24);
const aggregate = ref('5min');

const hourOptions = [
  { value: 1, label: '近 1 小时' },
  { value: 6, label: '近 6 小时' },
  { value: 24, label: '近 24 小时' },
  { value: 72, label: '近 3 天' },
];

const aggOptions = [
  { value: '', label: '原始值' },
  { value: '5min', label: '5 分钟聚合' },
  { value: 'hour', label: '小时聚合' },
];

async function loadMeta() {
  const [eq, th] = await Promise.all([api.getEquipment(), api.getThresholds()]);
  equipment.value = eq;
  thresholds.value = th;
  if (!equipmentId.value && eq.length) equipmentId.value = eq[0].id;
  await loadSeries();
}

async function loadSeries() {
  if (!equipmentId.value) return;
  series.value = await api.getReadings({
    equipmentId: equipmentId.value,
    pollutant: pollutant.value,
    hours: hours.value,
    aggregate: aggregate.value || undefined,
  });
}

const { loading, error, reload } = usePolling(async () => {
  if (!equipment.value.length) await loadMeta();
  else await loadSeries();
}, 15000);

watch([equipmentId, pollutant, hours, aggregate], () => loadSeries());

const effectiveThreshold = computed(() => {
  const specific = thresholds.value.find(
    (t) => t.equipment_id === Number(equipmentId.value) && t.pollutant === pollutant.value,
  );
  const global = thresholds.value.find(
    (t) => t.equipment_id == null && t.pollutant === pollutant.value,
  );
  return specific || global || {};
});

const stats = computed(() => {
  if (!series.value.length) return null;
  const values = series.value.map((d) => Number(d.avg_value ?? d.value));
  const max = Math.max(...values);
  const min = Math.min(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const overCount = series.value.filter((d) =>
    Number(d.max_value ?? d.value) >= Number(effectiveThreshold.value.warning),
  ).length;
  return { max, min, avg, overCount, total: values.length };
});

const currentEquipment = computed(() =>
  equipment.value.find((e) => e.id === Number(equipmentId.value)),
);
</script>

<template>
  <h2 class="page-title">排放趋势分析</h2>

  <div class="card" style="margin-bottom:14px">
    <div class="toolbar" style="margin-bottom:0">
      <label>
        监测点
        <select v-model.number="equipmentId">
          <option v-for="e in equipment" :key="e.id" :value="e.id">
            {{ e.name }}（{{ e.code }}）
          </option>
        </select>
      </label>
      <label>
        污染物
        <select v-model="pollutant">
          <option v-for="p in POLLUTANTS" :key="p.key" :value="p.key">{{ p.label }}</option>
        </select>
      </label>
      <label>
        时间范围
        <select v-model.number="hours">
          <option v-for="o in hourOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
      <label>
        粒度
        <select v-model="aggregate">
          <option v-for="o in aggOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
      <button class="btn" @click="reload" :disabled="loading">刷新</button>
      <span v-if="currentEquipment" class="muted" style="font-size:12px">
        预警限值 {{ effectiveThreshold.warning }} / 严重限值 {{ effectiveThreshold.critical }} mg/Nm³
      </span>
    </div>
  </div>

  <div v-if="error" class="card" style="color:#991b1b">加载失败：{{ error }}</div>

  <template v-else>
    <div class="grid" style="grid-template-columns: repeat(5, 1fr); margin-bottom:14px">
      <div class="card stat">
        <div class="stat-label">数据点</div>
        <div class="stat-value">{{ stats?.total ?? '—' }}</div>
      </div>
      <div class="card stat">
        <div class="stat-label">平均值</div>
        <div class="stat-value">{{ stats ? formatNumber(stats.avg) : '—' }}</div>
      </div>
      <div class="card stat">
        <div class="stat-label">最高值</div>
        <div
          class="stat-value"
          :class="stats && stats.max >= Number(effectiveThreshold.critical) ? 'danger-text'
            : stats && stats.max >= Number(effectiveThreshold.warning) ? 'warning-text' : ''"
        >{{ stats ? formatNumber(stats.max) : '—' }}</div>
      </div>
      <div class="card stat">
        <div class="stat-label">最低值</div>
        <div class="stat-value">{{ stats ? formatNumber(stats.min) : '—' }}</div>
      </div>
      <div class="card stat">
        <div class="stat-label">超标点数</div>
        <div class="stat-value" :class="stats?.overCount ? 'danger-text' : ''">
          {{ stats?.overCount ?? '—' }}
        </div>
      </div>
    </div>

    <div class="card">
      <h3>
        {{ currentEquipment?.name }} ·
        {{ POLLUTANTS.find((p) => p.key === pollutant)?.label }}排放曲线
      </h3>
      <div v-if="!series.length" class="muted" style="padding:60px 0;text-align:center">
        所选时间范围内暂无监测数据
      </div>
      <PollutantChart
        v-else
        :pollutant="pollutant"
        :data="series"
        :warning="Number(effectiveThreshold.warning)"
        :critical="Number(effectiveThreshold.critical)"
        :height="380"
      />
    </div>
  </template>
</template>

<style scoped>
label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-muted); }
.stat { text-align: center; padding: 14px; }
.stat-label { font-size: 12px; color: var(--text-muted); margin-bottom: 6px; }
.stat-value { font-size: 24px; font-weight: 700; }
</style>
