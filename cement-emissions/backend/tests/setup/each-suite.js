import { beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../../src/db/pool.js';
import { seedMasterData } from '../../src/services/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 每个测试文件执行前：清空所有业务表并重建结构 + 主数据，
 * 保证测试之间完全隔离。
 */
beforeAll(async () => {
  await pool.query(`
    DO $$ DECLARE r record;
    BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);
  const sql = await readFile(
    path.join(__dirname, '../../src/db/schema.sql'),
    'utf8',
  );
  await pool.query(sql);
  await seedMasterData();
}, 60000);

afterAll(async () => {
  await pool.end();
});
