import EmbeddedPostgres from 'embedded-postgres';
import { rm } from 'node:fs/promises';

const PORT = 5433;
const DATABASE = 'cement_test';
const DATA_DIR = process.env.PG_DATA_DIR || '/tmp/cement-embedded-pg';

let pg;

export default async function setup() {
  // 上次运行异常退出可能残留数据目录，先清理保证 initdb 成功
  await rm(DATA_DIR, { recursive: true, force: true });

  pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    host: '127.0.0.1',
    port: PORT,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();

  try {
    await pg.dropDatabase(DATABASE, true);
  } catch {
    /* 首次运行时库不存在，忽略 */
  }
  await pg.createDatabase(DATABASE);

  console.log(`[global-setup] 嵌入式 PostgreSQL 已启动 (port ${PORT})`);

  return async () => {
    await pg.stop();
    console.log('[global-setup] 嵌入式 PostgreSQL 已停止');
  };
}
