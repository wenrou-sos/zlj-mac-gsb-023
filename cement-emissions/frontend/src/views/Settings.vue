<script setup>
import { ref, computed, inject } from 'vue';
import { api } from '../api/client.js';
import { usePolling } from '../composables/usePolling.js';
import {
  POLLUTANTS,
  EQUIPMENT_STATUS,
} from '../constants.js';
import StatusBadge from '../components/StatusBadge.vue';
import { formatTime } from '../utils/format.js';

const notify = inject('notify');

const equipment = ref([]);
const thresholds = ref([]);
const injecting = ref(false);
const injectForm = ref({ equipmentId: null, pollutant: 'dust', value: null });

const thresholdForm = ref({
  equipmentId: '', pollutant: 'dust', warning: null, critical: null,
});

async function load() {
  const [eq, th] = await Promise.all([api.getEquipment(), api.getThresholds()]);
  equipment.value = eq;
  thresholds.value = th;
}
const { loading, reload } = usePolling(load, 15000, { immediate: true });

async function changeStatus(eq, status) {
  try {
    await api.setEquipmentStatus(eq.id, status);
    notify(`${eq.name} 已切换为「${EQUIPMENT_STATUS[status].label}」`);
    await reload();
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function saveThreshold() {
  try {
    await api.saveThreshold({
      equipmentId: thresholdForm.value.equipmentId
        ? Number(thresholdForm.value.equipmentId)
        : null,
      pollutant: thresholdForm.value.pollutant,
      warning: Number(thresholdForm.value.warning),
      critical: Number(thresholdForm.value.critical),
    });
    notify('限值已保存');
    thresholdForm.value = { equipmentId: '', pollutant: 'dust', warning: null, critical: null };
    await reload();
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function injectReading() {
  if (!injectForm.value.equipmentId || injectForm.value.value === null) {
    notify('请选择设备并填写数值', 'error');
    return;
  }
  injecting.value = true;
  try {
    const r = await api.postReading({
      equipmentId: Number(injectForm.value.equipmentId),
      pollutant: injectForm.value.pollutant,
      value: Number(injectForm.value.value),
    });
    if (r.level === 'ok') notify('读数正常，已入库');
    else if (r.suppressed) notify('超标读数已入库，但因设备状态告警被抑制', 'error');
    else if (r.merged) {
      notify(`超标读数已合并入告警组 #${r.alarmGroup.id}（第 ${r.alarmGroup.alarm_count} 次）`, 'error');
    } else {
      notify(`触发新告警并已创建处置事件 #${r.event.id}`, 'error');
    }
    injectForm.value.value = null;
    await reload();
  } catch (err) {
    notify(err.message, 'error');
  } finally {
    injecting.value = false;
  }
}

// 选中设备+污染物时回填现有限值，便于修改
function fillExisting() {
  const t = thresholds.value.find((x) =>
    (x.equipment_id === (thresholdForm.value.equipmentId
      ? Number(thresholdForm.value.equipmentId) : null))
    && x.pollutant === thresholdForm.value.pollutant,
  );
  if (t) {
    thresholdForm.value.warning = Number(t.warning);
    thresholdForm.value.critical = Number(t.critical);
  }
}

const globalThresholdRows = computed(() =>
  POLLUTANTS.map((p) => {
    const t = thresholds.value.find(
      (x) => x.equipment_id == null && x.pollutant === p.key,
    );
    return { ...p, threshold: t };
  }),
);

const equipmentThresholds = computed(() =>
  thresholds.value.filter((t) => t.equipment_id != null),
);
</script>

<template>
  <h2 class="page-title">设备与限值管理</h2>

  <div class="grid" style="grid-template-columns: 3fr 2fr; align-items:start; margin-bottom:14px">
    <!-- 设备状态 -->
    <div class="card">
      <h3>监测设备状态</h3>
      <table class="data">
        <thead>
          <tr><th>编码</th><th>名称</th><th>位置</th><th>状态</th><th>状态操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="eq in equipment" :key="eq.id">
            <td class="strong">{{ eq.code }}</td>
            <td>{{ eq.name }}</td>
            <td class="muted">{{ eq.location }}</td>
            <td><StatusBadge :map="EQUIPMENT_STATUS" :value="eq.status" /></td>
            <td>
              <select
                :value="eq.status"
                class="status-select"
                @change="changeStatus(eq, $event.target.value)"
              >
                <option v-for="(meta, key) in EQUIPMENT_STATUS" :key="key" :value="key">
                  {{ meta.label }}
                </option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="muted" style="font-size:12px;margin-top:8px">
        设备转为停机/检修后，该监测点的超标读数将只入库并标记为抑制告警，不产生处置事件；
        故障状态下仍会正常告警，提示重点排查。
      </div>
    </div>

    <!-- 手动注入读数（联调/演示） -->
    <div class="card">
      <h3>手工上报监测读数</h3>
      <p class="muted" style="font-size:12px;margin-top:0">
        模拟 CEMS 数据上报，用于验证告警合并与事件联动
      </p>
      <div class="form-row">
        <label>监测设备</label>
        <select v-model="injectForm.equipmentId">
          <option :value="null" disabled>请选择</option>
          <option v-for="e in equipment" :key="e.id" :value="String(e.id)">{{ e.name }}</option>
        </select>
      </div>
      <div class="form-row">
        <label>污染物</label>
        <select v-model="injectForm.pollutant">
          <option v-for="p in POLLUTANTS" :key="p.key" :value="p.key">{{ p.label }}</option>
        </select>
      </div>
      <div class="form-row">
        <label>数值（mg/Nm³）</label>
        <input v-model.number="injectForm.value" type="number" min="0" step="0.1" placeholder="如 35" />
      </div>
      <button class="btn btn-primary" :disabled="injecting" @click="injectReading">
        上报读数
      </button>
    </div>
  </div>

  <div class="grid" style="grid-template-columns: 1fr 1fr; align-items:start">
    <!-- 限值列表 -->
    <div class="card">
      <h3>排放限值配置</h3>
      <p class="muted" style="font-size:12px">
        预警限值达到即触发 warning，严重限值达到即触发 critical。设备专属限值优先于全局限值。
      </p>
      <table class="data">
        <thead><tr><th>适用范围</th><th>污染物</th><th>预警</th><th>严重</th><th>更新时间</th></tr></thead>
        <tbody>
          <tr v-for="row in globalThresholdRows" :key="`g-${row.key}`">
            <td>全局默认</td>
            <td>{{ row.label }}</td>
            <td class="warning-text strong">{{ row.threshold?.warning ?? '—' }}</td>
            <td class="danger-text strong">{{ row.threshold?.critical ?? '—' }}</td>
            <td class="muted" style="font-size:12px">
              {{ row.threshold ? formatTime(row.threshold.updated_at) : '—' }}
            </td>
          </tr>
          <tr v-for="t in equipmentThresholds" :key="`e-${t.id}`">
            <td>{{ t.equipment_code }}</td>
            <td>{{ POLLUTANTS.find((p) => p.key === t.pollutant)?.label }}</td>
            <td class="warning-text strong">{{ Number(t.warning) }}</td>
            <td class="danger-text strong">{{ Number(t.critical) }}</td>
            <td class="muted" style="font-size:12px">{{ formatTime(t.updated_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 编辑限值 -->
    <div class="card">
      <h3>{{ thresholdForm.equipmentId ? '设置设备专属限值' : '修改全局限值' }}</h3>
      <div class="form-row">
        <label>适用设备（不选则为全局限值）</label>
        <select v-model="thresholdForm.equipmentId" @change="fillExisting">
          <option value="">全局限值</option>
          <option v-for="e in equipment" :key="e.id" :value="String(e.id)">{{ e.name }}</option>
        </select>
      </div>
      <div class="form-row">
        <label>污染物</label>
        <select v-model="thresholdForm.pollutant" @change="fillExisting">
          <option v-for="p in POLLUTANTS" :key="p.key" :value="p.key">{{ p.label }}</option>
        </select>
      </div>
      <div class="two-col">
        <div class="form-row">
          <label>预警限值</label>
          <input v-model.number="thresholdForm.warning" type="number" min="0" step="0.1" />
        </div>
        <div class="form-row">
          <label>严重限值</label>
          <input v-model.number="thresholdForm.critical" type="number" min="0" step="0.1" />
        </div>
      </div>
      <button class="btn btn-primary" @click="saveThreshold">保存限值</button>
    </div>
  </div>
</template>

<style scoped>
.form-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.form-row label { font-size: 13px; color: var(--text-muted); }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.status-select { padding: 3px 8px; font-size: 12px; }
</style>
