<script setup>
import { computed } from 'vue';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'vue-chartjs';
import { POLLUTANT_MAP } from '../constants.js';
import { formatShortTime } from '../utils/format.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Tooltip,
  Legend,
  Filler,
);

const props = defineProps({
  pollutant: { type: String, required: true },
  // 原始读数：[{measured_at, value}] 或聚合：[{bucket, avg_value, max_value}]
  data: { type: Array, default: () => [] },
  warning: { type: Number, default: null },
  critical: { type: Number, default: null },
  height: { type: Number, default: 300 },
});

// 自定义插件：绘制预警（橙色虚线）/严重（红色虚线）限值线
const thresholdPlugin = {
  id: 'thresholdLines',
  draw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales.y) return;
    const lines = [
      { value: props.warning, color: '#d97706', label: `预警 ${props.warning}` },
      { value: props.critical, color: '#dc2626', label: `严重 ${props.critical}` },
    ];
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.2;
    ctx.font = '11px sans-serif';
    for (const line of lines) {
      if (line.value == null) continue;
      const y = scales.y.getPixelForValue(line.value);
      if (y < chartArea.top || y > chartArea.bottom) continue;
      ctx.strokeStyle = line.color;
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();
      ctx.fillStyle = line.color;
      ctx.fillText(line.label, chartArea.right - 78, y - 4);
    }
    ctx.restore();
  },
};

const isAggregated = computed(() => props.data.length > 0 && props.data[0].avg_value !== undefined);

const chartData = computed(() => {
  const meta = POLLUTANT_MAP[props.pollutant];
  if (isAggregated.value) {
    return {
      labels: props.data.map((d) => formatShortTime(d.bucket)),
      datasets: [
        {
          label: `${meta.label} 均值`,
          data: props.data.map((d) => Number(d.avg_value)),
          borderColor: meta.color,
          backgroundColor: `${meta.color}18`,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: `${meta.label} 峰值`,
          data: props.data.map((d) => Number(d.max_value)),
          borderColor: '#dc262699',
          borderDash: [3, 3],
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 1.2,
        },
      ],
    };
  }
  return {
    labels: props.data.map((d) => formatShortTime(d.measured_at)),
    datasets: [
      {
        label: `${meta.label} (${meta.unit})`,
        data: props.data.map((d) => Number(d.value)),
        borderColor: meta.color,
        backgroundColor: `${meta.color}18`,
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  };
});

const options = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: true, position: 'top', labels: { boxWidth: 14, font: { size: 12 } } },
    tooltip: {
      callbacks: {
        label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(1)} mg/Nm³`,
      },
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      title: { display: true, text: 'mg/Nm³', font: { size: 11 } },
      grid: { color: '#f1f5f9' },
    },
    x: {
      ticks: { maxTicksLimit: 10, font: { size: 10 } },
      grid: { display: false },
    },
  },
}));
</script>

<template>
  <div :style="{ height: `${height}px`, position: 'relative' }">
    <Line :data="chartData" :options="options" :plugins="[thresholdPlugin]" />
  </div>
</template>
