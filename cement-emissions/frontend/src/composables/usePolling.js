import { ref, onMounted, onUnmounted } from 'vue';

/**
 * 通用轮询 composable
 * @param {Function} fn 加载函数
 * @param {number} intervalMs 轮询间隔，0 表示不轮询
 */
export function usePolling(fn, intervalMs = 10000, { immediate = true } = {}) {
  const loading = ref(false);
  const error = ref(null);
  let timer = null;
  let stopped = false;

  async function load(showLoading = true) {
    if (showLoading) loading.value = true;
    error.value = null;
    try {
      await fn();
    } catch (err) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  onMounted(async () => {
    if (immediate) await load();
    if (intervalMs > 0) {
      timer = setInterval(() => { if (!stopped) load(false); }, intervalMs);
    }
  });

  onUnmounted(() => {
    stopped = true;
    clearInterval(timer);
  });

  return { loading, error, reload: () => load(true) };
}
