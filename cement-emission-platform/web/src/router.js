import { createRouter, createWebHistory } from 'vue-router';
import Dashboard from './views/Dashboard.vue';
import Alarms from './views/Alarms.vue';
import Events from './views/Events.vue';
import Equipment from './views/Equipment.vue';

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', name: 'dashboard', component: Dashboard, meta: { title: '监测总览' } },
    { path: '/alarms', name: 'alarms', component: Alarms, meta: { title: '告警管理' } },
    { path: '/events', name: 'events', component: Events, meta: { title: '超标事件' } },
    { path: '/equipment', name: 'equipment', component: Equipment, meta: { title: '设备状态' } },
  ],
});
