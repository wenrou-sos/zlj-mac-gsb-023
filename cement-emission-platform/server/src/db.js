'use strict';

const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.db);

async function query(text, params) {
  return pool.query(text, params);
}

/** 在事务中执行 fn(client)，自动提交/回滚 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, withTransaction, close };
