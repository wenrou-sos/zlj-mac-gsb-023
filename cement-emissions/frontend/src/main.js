import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import Dashboard from './views/Dashboard.vue';
import Trends from './views/Trends.vue';
import Alarms from './views/Alarms.vue';
import Events from './views/Events.vue';
import EventDetail from './views/EventDetail.vue';
import Settings from './views/Settings.vue';
import './styles.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: Dashboard },
    { path: '/trends', name: 'trends', component: Trends },
    { path: '/alarms', name: 'alarms', component: Alarms },
    { path: '/events', name: 'events', component: Events },
    { path: '/events/:id', name: 'event-detail', component: EventDetail, props: true },
    { path: '/settings', name: 'settings', component: Settings },
  ],
});

createApp(App).use(router).mount('#app');
