<template>
  <div>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- 统计卡片 -->
    <div class="stat-row" v-if="overview">
      <div class="stat-card">
        <div class="stat-num warn">{{ overview.alarms.active || 0 }}</div>
        <div class="stat-label">活动告警组</div>
      </div>
      <div class="stat-card">
        <div class="stat-num danger">{{ overview.events.pending || 0 }}</div>
        <div class="stat-label">待处置事件</div>
      </div>
      <div class="stat-card">
        <div class="stat-num processing">{{ overview.events.processing || 0 }}</div>
        <div class="stat-label">处置中事件</div>
      </div>
      <div class="stat-card">
        <div class="stat-num ok">{{ overview.equipment.running || 0 }}</div>
        <div class="stat-label">运行设备</div>
      </div>
      <div class="stat-card">
        <div class="stat-num muted-num">{{ (overview.equipment.maintenance || 0) + (overview.equipment.offline || 0) }}</div>
        <div class="stat-label">检修/停运设备</div>
      </div>
    </div>

    <!-- 实时浓度卡片 -->
    <div class="card">
      <h3>实时排放浓度（{{ lastUpdate }}）</h3>
      <div class="pollutant-grid" v-if="overview && points.length">
        <div v-for="point in points" :key="point.id" class="point-block">
          <div class="point-name">{{ point.name }}</div>
          <div class="metric-row">
            <div v-for="(meta, code) in pollutantMeta" :key="code" class="metric"
                 :class="{ exceeded: isExceeded(point.id, code) }">
              <div class="metric-name">{{ meta.name }}</div>
              <div class="metric-value">{{ latestValue(point.id, code) }}</div>
              <div class="metric-limit">限值 {{ limitOf(code) }} {{ meta.unit }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 趋势图 -->
    <div class="card">
      <div class="chart-header">
        <h3>排放趋势</h3>
        <div class="filters" style="margin-bottom:0">
          <select v-model="trendPoint">
            <option v-for="p in points" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <select v-model="trendPollutant">
            <option v-for="(meta, code) in pollutantMeta" :key="code" :value="code">{{ meta.name }}</option>
          </select>
        </div>
      </div>
      <div ref="chartEl" class="chart"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import * as echarts from 'echarts';
import { getOverview, getPoints, getEmissions } from '../api';
import { POLLUTANT_META, formatTime } from '../utils/format';

const overview = ref(null);
const points = ref([]);
const error = ref('');
const lastUpdate = ref('-');
const trendPoint = ref(null);
const trendPollutant = ref('nox');
const chartEl = ref(null);
const pollutantMeta = POLLUTANT_META;
let chart = null;
let timer = null;

const latestValue = (pointId, code) => {
  const item = overview.value?.latest?.[`${pointId}:${code}`];
  return item ? Number(item.value).toFixed(1) : '-';
};
const limitOf = (code) => overview.value?.standards?.[code]?.limit ?? '-';
const isExceeded = (pointId, code) => !!overview.value?.latest?.[`${pointId}:${code}`]?.exceeded;

async function loadOverview() {
  try {
    overview.value = await getOverview();
    lastUpdate.value = formatTime(new Date());
    error.value = '';
  } catch (e) { error.value = e.message; }
}

async function loadTrend() {
  if (!trendPoint.value) return;
  const from = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const res = await getEmissions({
    pointId: trendPoint.value, pollutant: trendPollutant.value, from, limit: 500,
  });
  const data = res.data.slice().reverse();
  const meta = POLLUTANT_META[trendPollutant.value];
  const limit = overview.value?.standards?.[trendPollutant.value]?.limit;
  chart?.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: data.map((d) => formatTime(d.measured_at).slice(11)) },
    yAxis: { type: 'value', name: meta.unit },
    series: [
      {
        name: meta.name, type: 'line', smooth: true, showSymbol: false,
        data: data.map((d) => Number(d.value)),
        lineStyle: { color: meta.color }, itemStyle: { color: meta.color },
        markLine: limit ? {
          silent: true, symbol: 'none',
          lineStyle: { color: '#f56c6c', type: 'dashed' },
          data: [{ yAxis: limit, label: { formatter: `限值 ${limit}` } }],
        } : undefined,
      },
    ],
  });
}

onMounted(async () => {
  const res = await getPoints();
  points.value = res.data;
  trendPoint.value = res.data[0]?.id ?? null;
  await loadOverview();
  chart = echarts.init(chartEl.value);
  await loadTrend();
  window.addEventListener('resize', () => chart?.resize());
  timer = setInterval(() => { loadOverview(); loadTrend(); }, 15000);
});

watch([trendPoint, trendPollutant], loadTrend);

onUnmounted(() => { clearInterval(timer); chart?.dispose(); });
</script>

<style scoped>
.stat-row { display: flex; gap: 14px; margin-bottom: 16px; flex-wrap: wrap; }
.stat-card {
  flex: 1; min-width: 150px; background: #fff; border-radius: 8px;
  padding: 18px; text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,.06);
}
.stat-num { font-size: 30px; font-weight: 700; }
.stat-num.warn { color: #e6a23c; } .stat-num.danger { color: #f56c6c; }
.stat-num.ok { color: #67c23a; } .stat-num.processing { color: #409eff; }
.stat-num.muted-num { color: #909399; }
.stat-label { color: #909399; font-size: 13px; margin-top: 6px; }
.pollutant-grid { display: flex; flex-direction: column; gap: 14px; }
.point-block { border: 1px solid #ebeef5; border-radius: 8px; padding: 14px; }
.point-name { font-weight: 600; margin-bottom: 10px; }
.metric-row { display: flex; gap: 12px; flex-wrap: wrap; }
.metric {
  flex: 1; min-width: 140px; background: #f5f7fa; border-radius: 6px;
  padding: 12px; text-align: center; border: 1px solid transparent;
}
.metric.exceeded { background: #fef0f0; border-color: #f56c6c; }
.metric.exceeded .metric-value { color: #f56c6c; }
.metric-name { font-size: 12px; color: #909399; }
.metric-value { font-size: 24px; font-weight: 700; margin: 4px 0; }
.metric-limit { font-size: 11px; color: #c0c4cc; }
.chart-header { display: flex; justify-content: space-between; align-items: center; }
.chart { height: 320px; margin-top: 10px; }
</style>
