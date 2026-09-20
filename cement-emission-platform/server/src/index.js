'use strict';

const fs = require('fs');
const path = require('path');
const { createApp } = require('./app');
const db = require('./db');
const config = require('./config');
const { startSimulator } = require('./simulator');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.query(sql);
}

async function waitForDb(retries = 30, delayMs = 1000) {
  for (let i = 0; i < retries; i += 1) {
    try {
      await db.query('SELECT 1');
      return;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function main() {
  await waitForDb();
  await migrate();

  // 首次启动自动写入演示数据
  const { rows } = await db.query('SELECT count(*)::int AS c FROM monitoring_points');
  if (rows[0].c === 0) {
    const { seed } = require('./seed');
    await seed();
    console.log('[init] 演示数据已写入');
  }

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[server] 排放监测服务已启动: http://localhost:${config.port}`);
  });

  if (config.simulator.enabled) {
    startSimulator();
  }
}

main().catch((err) => {
  console.error('[server] 启动失败:', err);
  process.exit(1);
});
