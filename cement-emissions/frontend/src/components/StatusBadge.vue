<script setup>
import { computed } from 'vue';

const props = defineProps({
  map: { type: Object, required: true },
  value: { type: String, required: true },
});

const meta = computed(() => props.map[props.value] || { label: props.value, color: '#333', bg: '#eee' });
</script>

<template>
  <span
    class="badge"
    :style="{ color: meta.color, background: meta.bg }"
  >{{ meta.label }}</span>
</template>
