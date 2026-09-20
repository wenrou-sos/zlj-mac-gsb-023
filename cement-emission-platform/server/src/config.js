'use strict';

module.exports = {
  port: Number(process.env.PORT || 3000),
  db: {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'cement',
    password: process.env.PGPASSWORD || 'cement123',
    database: process.env.PGDATABASE || 'cement_emission',
    // 测试环境允许注入自定义 pool
    max: Number(process.env.PGPOOL_MAX || 10),
  },
  alarm: {
    // 告警合并窗口：同一监测点同一污染物在该窗口内的连续告警合并为一组
    mergeWindowMinutes: Number(process.env.ALARM_MERGE_WINDOW_MINUTES || 30),
    // 组内告警数达到该阈值时自动生成超标事件
    eventThresholdCount: Number(process.env.EVENT_THRESHOLD_COUNT || 3),
  },
  simulator: {
    enabled: process.env.SIMULATOR_ENABLED === 'true',
    intervalMs: Number(process.env.SIMULATOR_INTERVAL_MS || 10000),
  },
};
