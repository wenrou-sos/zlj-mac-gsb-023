#!/usr/bin/env node
/**
 * 本地开发用嵌入式 PostgreSQL 管理（无需系统安装 PG / Docker）。
 *   node scripts/pg-local.mjs start   # 初始化并启动，创建数据库
 *   node scripts/pg-local.mjs stop    # 停止
 * 数据目录位于 .local-pgdata，数据持久化，可用 start --fresh 重置。
 */
import EmbeddedPostgres from 'embedded-postgres';
import { rm, access } from 'node:fs/promises';

const PORT = Number(process.env.LOCAL_PG_PORT || 5432);
const DATABASE = process.env.LOCAL_PG_DB || 'cement_emissions';
const DATA_DIR = new URL('../.local-pgdata', import.meta.url).pathname;

function create() {
  return new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: process.env.LOCAL_PG_USER || 'postgres',
    password: process.env.LOCAL_PG_PASSWORD || 'postgres',
    host: '127.0.0.1',
    port: PORT,
    persistent: true,
  });
}

const command = process.argv[2];

if (command === 'start') {
  const pg = create();
  if (process.argv.includes('--fresh')) {
    await rm(DATA_DIR, { recursive: true, force: true });
  }
  // 仅在数据目录尚未初始化时执行 initdb（重复 initdb 会报错）
  const alreadyInitialised = await access(`${DATA_DIR}/PG_VERSION`)
    .then(() => true)
    .catch(() => false);
  if (!alreadyInitialised) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase(DATABASE);
    console.log(`[pg-local] 数据库 ${DATABASE} 已创建`);
  } catch (err) {
    if (!String(err.message).includes('already exists')) throw err;
  }
  console.log(`[pg-local] PostgreSQL 运行于 127.0.0.1:${PORT}/${DATABASE}`);
  console.log('[pg-local] 保持本进程运行以维持数据库，Ctrl+C 停止');

  const shutdown = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} else if (command === 'stop') {
  const pg = create();
  await pg.stop();
  console.log('[pg-local] 已停止');
} else {
  console.error('用法: node scripts/pg-local.mjs <start|stop> [--fresh]');
  process.exit(1);
}
