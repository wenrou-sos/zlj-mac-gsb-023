import { config } from './config.js';
import { createApp } from './app.js';
import { runSchema, waitForDatabase, pool } from './db/migrate.js';
import { seedIfEmpty } from './services/seed.js';
import { startSimulation } from './services/simulator.js';

async function main() {
  await waitForDatabase();
  await runSchema();

  if (config.seedOnStart) {
    const seeded = await seedIfEmpty({ withHistory: true });
    if (seeded) console.log('[startup] 已初始化主数据与 24 小时历史数据');
  }

  let stopSimulation = null;
  if (config.simulation.enabled) {
    stopSimulation = startSimulation(config.simulation.intervalMs);
    console.log(
      `[startup] 实时数据模拟已开启，间隔 ${config.simulation.intervalMs}ms`,
    );
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[startup] 排放监测 API 运行于 http://localhost:${config.port}`);
  });

  const shutdown = async () => {
    console.log('\n[shutdown] 正在关闭服务...');
    if (stopSimulation) stopSimulation();
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[startup] 启动失败:', err);
  process.exit(1);
});
