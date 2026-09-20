<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';
import { usePolling } from '../composables/usePolling.js';
import {
  POLLUTANTS,
  POLLUTANT_MAP,
  EQUIPMENT_STATUS,
  ALARM_STATUS,
  SEVERITY,
  EVENT_STATUS,
} from '../constants.js';
import StatusBadge from '../components/StatusBadge.vue';
import { formatNumber, formatShortTime, relativeFromNow } from '../utils/format.js';

const router = useRouter();
const overview = ref(null);
const equipment = ref([]);
const thresholds = ref([]);
const activeAlarms = ref([]);
const openEvents = ref([]);

async function loadAll() {
  const [ov, eq, th, alarms, events] = await Promise.all([
    api.getOverview(),
    api.getEquipment(),
    api.getThresholds(),
    api.getAlarms({ status: 'active', limit: 8 }),
    api.getEvents({ limit: 8 }),
  ]);
  overview.value = ov;
  equipment.value = eq;
  thresholds.value = th;
  activeAlarms.value = alarms;
  openEvents.value = events;
}

const { loading, error, reload } = usePolling(loadAll, 10000);

// 设备 × 污染物 最新值矩阵
const latestMap = computed(() => {
  const map = {};
  for (const r of overview.value?.latestReadings || []) {
    map[`${r.equipment_id}:${r.pollutant}`] = r;
  }
  return map;
});

// 每个设备当前开启的告警（按设备聚合）
const openAlarmByEq = computed(() => {
  const map = {};
  for (const a of activeAlarms.value) {
    const key = a.equipment_id;
    if (!map[key] || (a.severity === 'critical' && map[key].severity !== 'critical')) {
      map[key] = a;
    }
  }
  return map;
});

const globalThresholds = computed(() => {
  const map = {};
  for (const t of thresholds.value.filter((x) => x.equipment_id == null)) {
    map[t.pollutant] = t;
  }
  return map;
});

function levelFor(value, pollutant) {
  const t = globalThresholds.value[pollutant];
  if (!t) return 'ok';
  if (value >= Number(t.critical)) return 'critical';
  if (value >= Number(t.warning)) return 'warning';
  return 'ok';
}

function cellClass(eqId, pollutant) {
  const cell = latestMap.value[`${eqId}:${pollutant}`];
  if (!cell) return '';
  const level = levelFor(Number(cell.value), pollutant);
  return level === 'critical' ? 'danger-text' : level === 'warning' ? 'warning-text' : 'ok-text';
}

function goEquipment(eqId) {
  router.push({ path: '/trends', query: { equipment: String(eqId) } });
}

const equipmentStatusCount = computed(() => {
  const counts = {};
  for (const e of equipment.value) {
    counts[e.status] = (counts[e.status] || 0) + 1;
  }
  return counts;
});

const todayPeak = computed(() => {
  const out = {};
  for (const r of overview.value?.todayAlarms || []) {
    out[r.pollutant] = r;
  }
  return out;
});
</script>

<template>
  <div v-if="error" class="card" style="border-color:#fecaca;background:#fef2f2;color:#991b1b">
    加载数据失败：{{ error }}
    <button class="btn btn-sm" style="margin-left:10px" @click="reload">重试</button>
  </div>

  <div v-else-if="overview">
    <!-- KPI 卡片 -->
    <div class="grid kpi-row" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 14px;">
      <div class="card kpi">
        <div class="kpi-label">监测设备</div>
        <div class="kpi-value">{{ equipment.length }}<span class="kpi-unit">台</span></div>
        <div class="kpi-foot">
          <span v-for="(meta, key) in EQUIPMENT_STATUS" :key="key">
            <span v-if="equipmentStatusCount[key]">
              <StatusBadge :map="EQUIPMENT_STATUS" :value="key" />
              {{ equipmentStatusCount[key] }}台
            </span>
          </span>
        </div>
      </div>
      <div
        v-for="p in POLLUTANTS"
        :key="p.key"
        class="card kpi"
      >
        <div class="kpi-label">
          <span class="dot" :style="{ background: p.color }"></span>{{ p.label }}今日峰值
        </div>
        <div class="kpi-value" :class="cellClass(0, p.key)">
          {{ todayPeak[p.key] ? formatNumber(todayPeak[p.key].peak) : '—' }}
          <span class="kpi-unit">{{ p.unit }}</span>
        </div>
        <div class="kpi-foot">
          今日超标 <strong :class="todayPeak[p.key]?.count ? 'danger-text' : ''">
            {{ todayPeak[p.key]?.count || 0 }}
          </strong> 次
          <span class="muted" style="margin-left:8px">
            限值 {{ globalThresholds[p.key]?.warning ?? '—' }}/{{ globalThresholds[p.key]?.critical ?? '—' }}
          </span>
        </div>
      </div>
    </div>

    <div class="grid" style="grid-template-columns: 2fr 1fr; margin-bottom: 14px;">
      <!-- 实时读数矩阵 -->
      <div class="card">
        <h3>各监测点实时排放值（mg/Nm³）</h3>
        <table class="data">
          <thead>
            <tr>
              <th>监测设备</th>
              <th>状态</th>
              <th v-for="p in POLLUTANTS" :key="p.key">
                <span class="dot" :style="{ background: p.color }"></span>{{ p.label }}
              </th>
              <th>最近上报</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="eq in equipment"
              :key="eq.id"
              class="eq-row"
              @click="goEquipment(eq.id)"
            >
              <td>
                <div class="strong">{{ eq.name }}</div>
                <div class="muted" style="font-size:12px">{{ eq.code }} · {{ eq.location }}</div>
              </td>
              <td><StatusBadge :map="EQUIPMENT_STATUS" :value="eq.status" /></td>
              <td v-for="p in POLLUTANTS" :key="p.key">
                <span class="strong" :class="cellClass(eq.id, p.key)">
                  {{ latestMap[`${eq.id}:${p.key}`]
                    ? formatNumber(latestMap[`${eq.id}:${p.key}`].value, 1)
                    : '—' }}
                </span>
              </td>
              <td class="muted" style="font-size:12px">
                {{ latestMap[`${eq.id}:dust`] ? relativeFromNow(latestMap[`${eq.id}:dust`].measured_at) : '—' }}
              </td>
            </tr>
          </tbody>
        </table>
        <div class="muted" style="font-size:12px;margin-top:8px">
          点击设备行查看排放趋势曲线；数值
          <span class="warning-text">橙色</span>为预警、
          <span class="danger-text">红色</span>为严重超标。
        </div>
      </div>

      <!-- 设备状态关联的活跃告警 -->
      <div class="card">
        <h3>活跃告警（已按窗口合并）</h3>
        <div v-if="!activeAlarms.length" class="empty">
          <div style="font-size:28px">✅</div>
          <div>当前无活跃告警</div>
        </div>
        <div
          v-for="a in activeAlarms"
          :key="a.id"
          class="alarm-item"
          @click="router.push('/alarms')"
        >
          <div class="alarm-head">
            <StatusBadge :map="SEVERITY" :value="a.severity" />
            <span class="strong">{{ POLLUTANT_MAP[a.pollutant].label }}</span>
            <span class="muted">{{ a.equipment_name }}</span>
          </div>
          <div class="alarm-meta">
            峰值 <span class="danger-text">{{ formatNumber(a.peak_value) }}</span> /
            合并 <strong>{{ a.alarm_count }}</strong> 次 /
            最近 {{ relativeFromNow(a.last_alarm_at) }}
          </div>
        </div>
      </div>
    </div>

    <div class="grid" style="grid-template-columns: 1fr 1fr;">
      <!-- 待处置事件 -->
      <div class="card">
        <h3>超标处置事件</h3>
        <div v-if="!openEvents.length" class="empty muted">暂无事件</div>
        <table v-else class="data">
          <thead>
            <tr><th>设备 / 污染物</th><th>严重度</th><th>状态</th><th>负责人</th></tr>
          </thead>
          <tbody>
            <tr
              v-for="ev in openEvents"
              :key="ev.id"
              class="eq-row"
              @click="router.push(`/events/${ev.id}`)"
            >
              <td>
                <div class="strong">{{ ev.equipment_name }}</div>
                <div class="muted" style="font-size:12px">
                  {{ POLLUTANT_MAP[ev.pollutant].label }} · 峰值 {{ formatNumber(ev.peak_value) }}
                </div>
              </td>
              <td><StatusBadge :map="SEVERITY" :value="ev.severity" /></td>
              <td><StatusBadge :map="EVENT_STATUS" :value="ev.status" /></td>
              <td>{{ ev.handler || '未指派' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 今日告警分布 -->
      <div class="card">
        <h3>今日分污染物告警分布</h3>
        <div class="today-bars">
          <div v-for="p in POLLUTANTS" :key="p.key" class="today-row">
            <div class="today-label">
              <span class="dot" :style="{ background: p.color }"></span>{{ p.label }}
            </div>
            <div class="bar-track">
              <div
                class="bar-fill"
                :style="{
                  width: `${Math.min(100, (todayPeak[p.key]?.count || 0) * 8)}%`,
                  background: p.color,
                }"
              ></div>
            </div>
            <div class="today-count">{{ todayPeak[p.key]?.count || 0 }} 次</div>
          </div>
        </div>
        <div class="muted" style="font-size:12px;margin-top:14px">
          合并规则：同一设备同一污染物在 10 分钟窗口内的重复超标合并为一条告警，
          避免告警风暴；停机/检修期间告警自动抑制并与设备状态关联。
        </div>
      </div>
    </div>
  </div>

  <div v-else class="card muted">加载中…</div>
</template>

<style scoped>
.kpi { display: flex; flex-direction: column; gap: 8px; }
.kpi-label { color: var(--text-muted); font-size: 13px; display: flex; align-items: center; gap: 6px; }
.kpi-value { font-size: 30px; font-weight: 700; line-height: 1.1; }
.kpi-unit { font-size: 13px; font-weight: 400; color: var(--text-muted); margin-left: 6px; }
.kpi-foot { font-size: 12px; color: var(--text-muted); display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 2px; }
.eq-row { cursor: pointer; }
.alarm-item {
  padding: 10px 4px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.alarm-item:hover { background: #f8fafc; }
.alarm-head { display: flex; gap: 8px; align-items: center; }
.alarm-meta { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
.empty { text-align: center; color: var(--text-muted); padding: 30px 0; display: flex; flex-direction: column; gap: 8px; }
.today-row { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.today-label { width: 80px; font-size: 13px; }
.bar-track { flex: 1; height: 14px; background: #f1f5f9; border-radius: 7px; overflow: hidden; min-width: 100px; }
.bar-fill { height: 100%; border-radius: 7px; transition: width .4s; min-width: 2px; }
.today-count { width: 56px; text-align: right; font-size: 13px; }
@media (max-width: 1100px) {
  .kpi-row { grid-template-columns: repeat(2, 1fr) !important; }
}
</style>
