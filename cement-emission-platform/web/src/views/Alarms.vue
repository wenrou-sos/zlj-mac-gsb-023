<template>
  <div class="card">
    <h3>告警组（连续超标自动合并）</h3>
    <div class="filters">
      <select v-model="filters.status">
        <option value="">全部状态</option>
        <option value="active">活动中</option>
        <option value="closed">已关闭</option>
      </select>
      <select v-model="filters.pollutant">
        <option value="">全部污染物</option>
        <option v-for="(m, c) in pollutantMeta" :key="c" :value="c">{{ m.name }}</option>
      </select>
      <button class="btn ghost" @click="load">刷新</button>
    </div>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <table>
      <thead>
        <tr>
          <th>监测点</th><th>污染物</th><th>级别</th><th>合并告警数</th>
          <th>峰值</th><th>限值</th><th>首警时间</th><th>末警时间</th>
          <th>状态</th><th>免考核</th><th>关联事件</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="g in groups" :key="g.id">
          <tr>
            <td>{{ g.point_name }}</td>
            <td>{{ pollutantMeta[g.pollutant]?.name || g.pollutant }}</td>
            <td><span class="tag" :style="{ background: severityColor(g.severity) }">{{ severityLabel(g.severity) }}</span></td>
            <td>{{ g.alarm_count }}</td>
            <td>{{ g.max_value }}</td>
            <td>{{ g.limit_value }}</td>
            <td>{{ formatTime(g.first_alarm_at) }}</td>
            <td>{{ formatTime(g.last_alarm_at) }}</td>
            <td>{{ g.status === 'active' ? '活动中' : '已关闭' }}</td>
            <td>
              <span v-if="g.exempt" class="tag" style="background:#909399"
                    :title="`设备状态: ${g.equipment_status || '-'}`">免考核</span>
              <span v-else class="muted">-</span>
            </td>
            <td>
              <router-link v-if="g.event_id" to="/events">#{{ g.event_id }}</router-link>
              <span v-else class="muted">-</span>
            </td>
            <td>
              <button class="btn ghost" @click="toggleDetail(g)">
                {{ expanded === g.id ? '收起' : '明细' }}
              </button>
              <button v-if="g.status === 'active'" class="btn" style="margin-left:6px"
                      @click="closeGroup(g)">关闭</button>
            </td>
          </tr>
          <tr v-if="expanded === g.id">
            <td colspan="12" class="detail-cell">
              <div v-if="detail">
                <p class="muted" style="margin-bottom:8px">
                  {{ groupMergeSummary(detail.group) }}
                  <span v-if="detail.group.equipment_status">
                    ｜告警时设备状态：{{ equipmentLabel(detail.group.equipment_status) }}
                  </span>
                </p>
                <table>
                  <thead><tr><th>时间</th><th>数值</th><th>限值</th><th>级别</th><th>说明</th></tr></thead>
                  <tbody>
                    <tr v-for="a in detail.alarms" :key="a.id">
                      <td>{{ formatTime(a.created_at) }}</td>
                      <td>{{ a.value }}</td>
                      <td>{{ a.limit_value }}</td>
                      <td><span class="tag" :style="{ background: severityColor(a.severity) }">{{ severityLabel(a.severity) }}</span></td>
                      <td>{{ a.message }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </td>
          </tr>
        </template>
        <tr v-if="!groups.length"><td colspan="12" class="muted" style="text-align:center">暂无告警</td></tr>
      </tbody>
    </table>
    <div class="pager">
      <button class="btn ghost" :disabled="page <= 1" @click="page--; load()">上一页</button>
      <span class="muted">第 {{ page }} 页 / 共 {{ total }} 条</span>
      <button class="btn ghost" :disabled="page * size >= total" @click="page++; load()">下一页</button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';
import { getAlarmGroups, getAlarmGroupDetail, closeAlarmGroup } from '../api';
import {
  POLLUTANT_META, SEVERITY_META, EQUIPMENT_STATUS_META,
  formatTime, groupMergeSummary,
} from '../utils/format';

const groups = ref([]);
const total = ref(0);
const page = ref(1);
const size = 20;
const filters = ref({ status: '', pollutant: '' });
const expanded = ref(null);
const detail = ref(null);
const error = ref('');
const pollutantMeta = POLLUTANT_META;

const severityColor = (s) => SEVERITY_META[s]?.color || '#909399';
const severityLabel = (s) => SEVERITY_META[s]?.label || s;
const equipmentLabel = (s) => EQUIPMENT_STATUS_META[s]?.label || s;

async function load() {
  try {
    const res = await getAlarmGroups({ ...filters.value, page: page.value, size });
    groups.value = res.data;
    total.value = res.total;
    error.value = '';
  } catch (e) { error.value = e.message; }
}

async function toggleDetail(g) {
  if (expanded.value === g.id) { expanded.value = null; return; }
  expanded.value = g.id;
  detail.value = null;
  detail.value = await getAlarmGroupDetail(g.id);
}

async function closeGroup(g) {
  await closeAlarmGroup(g.id);
  await load();
}

watch(filters, () => { page.value = 1; load(); }, { deep: true });
onMounted(load);
</script>

<style scoped>
.detail-cell { background: #fafafa; }
.pager { display: flex; gap: 12px; align-items: center; margin-top: 14px; justify-content: flex-end; }
</style>
