<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { api } from '../api/client.js';

// 导航栏徽标实时显示未确认告警与待办事件数，5 秒轮询
const activeAlarms = ref(0);
const openEvents = ref(0);

async function refreshBadges() {
  try {
    const overview = await api.getOverview();
    activeAlarms.value = overview.alarmsByStatusSeverity
      .filter((r) => r.status === 'active')
      .reduce((s, r) => s + Number(r.count), 0);
    // 待办事件：待派单 + 已派单 + 处置中
    openEvents.value = overview.eventsByStatus
      .filter((r) => ['open', 'dispatched', 'handling'].includes(r.status))
      .reduce((s, r) => s + Number(r.count), 0);
  } catch { /* 后端未启动时静默 */ }
}

let timer = null;
onMounted(() => {
  refreshBadges();
  timer = setInterval(refreshBadges, 5000);
});
onUnmounted(() => clearInterval(timer));

const nav = [
  { to: '/', label: '监测总览', exact: true },
  { to: '/trends', label: '排放趋势' },
  { to: '/alarms', label: '告警管理' },
  { to: '/events', label: '超标事件' },
  { to: '/settings', label: '设备与限值' },
];
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <span class="logo">🏭</span>
      <div>
        <div class="title">水泥生产排放监测平台</div>
        <div class="subtitle">粉尘 · 氮氧化物 · 二氧化硫 连续在线监测</div>
      </div>
    </div>
    <nav class="nav">
      <RouterLink
        v-for="item in nav"
        :key="item.to"
        :to="item.to"
        class="nav-item"
        :class="{ active: $route.path === item.to || (!item.exact && $route.path.startsWith(item.to)) }"
      >
        {{ item.label }}
        <span
          v-if="(item.to === '/alarms' || item.to === '/events') && (item.to === '/alarms' ? activeAlarms : openEvents) > 0"
          class="nav-badge"
        >
          {{ (item.to === '/alarms' ? activeAlarms : openEvents) > 99
             ? '99+'
             : (item.to === '/alarms' ? activeAlarms : openEvents) }}
        </span>
      </RouterLink>
    </nav>
  </header>
</template>

<style scoped>
.topbar {
  background: linear-gradient(120deg, #0c4a6e, #0369a1);
  color: #fff;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  box-shadow: 0 2px 8px rgba(2, 60, 90, .3);
}
.brand { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.logo { font-size: 30px; }
.title { font-size: 18px; font-weight: 600; }
.subtitle { font-size: 12px; opacity: .8; margin-top: 2px; }
.nav { display: flex; gap: 4px; }
.nav-item {
  color: rgba(255, 255, 255, .82);
  padding: 22px 16px;
  font-size: 14px;
  position: relative;
  text-decoration: none;
  border-bottom: 3px solid transparent;
}
.nav-item:hover { color: #fff; background: rgba(255, 255, 255, .06); }
.nav-item.active {
  color: #fff;
  border-bottom-color: #fbbf24;
  background: rgba(255, 255, 255, .08);
}
.nav-badge {
  display: inline-block;
  min-width: 18px;
  padding: 0 5px;
  margin-left: 4px;
  border-radius: 9px;
  background: #ef4444;
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}
</style>
