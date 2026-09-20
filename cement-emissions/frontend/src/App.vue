<script setup>
import { ref, provide } from 'vue';
import NavBar from './components/NavBar.vue';

const toast = ref(null);
let timer = null;

function notify(message, type = 'success') {
  toast.value = { message, type };
  clearTimeout(timer);
  timer = setTimeout(() => { toast.value = null; }, 3200);
}

// 全局提示：provide('notify', notify)，任意页面 inject 使用
provide('notify', notify);
</script>

<template>
  <div class="layout">
    <NavBar />
    <main class="content">
      <RouterView v-slot="{ Component }">
        <component :is="Component" />
      </RouterView>
    </main>
    <transition name="fade">
      <div v-if="toast" class="toast" :class="toast.type">{{ toast.message }}</div>
    </transition>
  </div>
</template>

<style scoped>
.layout { min-height: 100vh; }
.content {
  max-width: 1400px;
  margin: 0 auto;
  padding: 22px 24px 40px;
}
.fade-enter-active, .fade-leave-active { transition: opacity .25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
