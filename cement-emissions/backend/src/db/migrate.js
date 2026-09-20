import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool, query } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runSchema() {
  const sql = await readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  await query(sql);
}

export async function waitForDatabase(retries = 30, delayMs = 1000) {
  for (let i = 0; i < retries; i += 1) {
    try {
      await query('SELECT 1');
      return;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export { pool };
