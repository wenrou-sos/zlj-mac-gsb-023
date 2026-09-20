<template>
  <div class="card">
    <h3>设备状态与告警关联</h3>
    <p class="muted" style="margin-bottom:12px">
      设备转入「检修 / 停运」后，其监测点新产生的超标告警将自动标记为免考核，不再生成超标事件；活动告警组同步关闭。
    </p>
    <div v-if="error" class="error-banner">{{ error }}</div>
    <table>
      <thead>
        <tr>
          <th>设备编号</th><th>设备名称</th><th>类型</th><th>关联监测点</th>
          <th>当前状态</th><th>活动告警组</th><th>更新时间</th><th>变更状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="eq in equipment" :key="eq.id">
          <td>{{ eq.code }}</td>
          <td>{{ eq.name }}</td>
          <td>{{ typeLabel(eq.type) }}</td>
          <td>{{ eq.point_name || '-' }}</td>
          <td><span class="tag" :style="{ background: statusColor(eq.status) }">{{ statusLabel(eq.status) }}</span></td>
          <td>
            <span v-if="eq.active_alarm_groups > 0" class="tag" style="background:#f56c6c">
              {{ eq.active_alarm_groups }}
            </span>
            <span v-else class="muted">0</span>
          </td>
          <td>{{ formatTime(eq.updated_at) }}</td>
          <td>
            <select :value="eq.status" @change="changeStatus(eq, $event.target.value)">
              <option v-for="(m, s) in statusMeta" :key="s" :value="s">{{ m.label }}</option>
            </select>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { getEquipment, updateEquipmentStatus } from '../api';
import { EQUIPMENT_STATUS_META, formatTime } from '../utils/format';

const equipment = ref([]);
const error = ref('');
const statusMeta = EQUIPMENT_STATUS_META;

const TYPE_LABELS = {
  kiln: '回转窑', cooler: '篦冷机', mill: '磨机',
  dust_collector: '除尘器', denitration: '脱硝系统',
};

const statusColor = (s) => EQUIPMENT_STATUS_META[s]?.color || '#909399';
const statusLabel = (s) => EQUIPMENT_STATUS_META[s]?.label || s;
const typeLabel = (t) => TYPE_LABELS[t] || t;

async function load() {
  try {
    const res = await getEquipment();
    equipment.value = res.data;
    error.value = '';
  } catch (e) { error.value = e.message; }
}

async function changeStatus(eq, status) {
  try {
    const result = await updateEquipmentStatus(eq.id, status);
    if (result.closedGroups?.length) {
      alert(`已联动关闭 ${result.closedGroups.length} 个活动告警组（标记免考核）`);
    }
    await load();
  } catch (e) {
    error.value = e.message;
    await load();
  }
}

onMounted(load);
</script>
