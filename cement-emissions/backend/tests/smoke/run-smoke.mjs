// 端到端冒烟：启动嵌入式 PG -> 启动 API 服务（含种子与实时模拟）-> 校验接口
import EmbeddedPostgres from 'embedded-postgres';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = '/tmp/cement-smoke-pg';
const PORT_PG = 5434;
const PORT_API = 4055;
const DATABASE = 'cement_smoke';
const BASE = `http://127.0.0.1:${PORT_API}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* 尚未就绪 */ }
    await sleep(500);
  }
  throw new Error(`等待 ${url} 超时`);
}

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.error(`  ✗ ${name} ${extra}`);
  }
};

async function main() {
  await rm(DATA_DIR, { recursive: true, force: true });
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR, user: 'postgres', password: 'postgres',
    host: '127.0.0.1', port: PORT_PG, persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DATABASE);
  console.log('冒烟: PostgreSQL 已启动');

  const server = spawn('node', [path.join(__dirname, '../../src/server.js')], {
    env: {
      ...process.env,
      DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${PORT_PG}/${DATABASE}`,
      PORT: String(PORT_API),
      // 冒烟场景需要确定性：关闭实时模拟，读数全部由脚本显式注入
      SIMULATION_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[api-err] ${d}`));

  try {
    await waitFor(`${BASE}/api/health`, 90000);
    console.log('冒烟: API 已就绪（种子数据初始化完成）');

    const health = await (await fetch(`${BASE}/api/health`)).json();
    check('健康检查', health.status === 'ok');

    const equipment = await (await fetch(`${BASE}/api/equipment`)).json();
    check('种子设备 4 台', equipment.length === 4, `实际 ${equipment.length}`);

    // 模拟器关闭，由脚本显式注入：先发一轮正常读数，验证最新读数矩阵
    for (const eq of equipment) {
      for (const [pollutant, value] of [['dust', 10], ['nox', 180], ['so2', 80]]) {
        const r = await fetch(`${BASE}/api/readings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ equipmentId: eq.id, pollutant, value }),
        });
        if (!r.ok) { check(`注入 ${eq.code} ${pollutant}`, false); break; }
      }
    }

    const latest = await (await fetch(`${BASE}/api/readings/latest`)).json();
    check(
      '最新读数覆盖 4 设备 × 3 污染物',
      latest.length >= 12,
      `实际 ${latest.length} 条`,
    );

    const eqId = equipment[0].id;
    // 首次严重超标读数，应创建新告警组与 open 事件
    const posted = await (await fetch(`${BASE}/api/readings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ equipmentId: eqId, pollutant: 'dust', value: 42 }),
    })).json();
    check('超标注入触发 critical 事件',
      posted.level === 'critical' && posted.merged === false &&
      posted.event?.status === 'open');

    // 完整处置闭环
    const eventId = posted.event.id;
    for (const body of [
      { toStatus: 'handling', actor: '张工', note: '到场处置' },
      { toStatus: 'resolved', actor: '张工', resolution: '更换破损滤袋' },
      { toStatus: 'closed', actor: '值班长', note: '复测达标' },
    ]) {
      const r = await fetch(`${BASE}/api/events/${eventId}/transition`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      check(`事件流转 -> ${body.toStatus}`, r.ok);
    }

    // 非法流转
    const bad = await fetch(`${BASE}/api/events/${eventId}/transition`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStatus: 'handling' }),
    });
    check('终态非法流转被拒 (400)', bad.status === 400);

    // 设备停机后超标抑制
    await fetch(`${BASE}/api/equipment/${eqId}/status`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'stopped' }),
    });
    const suppressed = await (await fetch(`${BASE}/api/readings`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ equipmentId: eqId, pollutant: 'dust', value: 80 }),
    })).json();
    check('停机状态告警被抑制',
      suppressed.suppressed === true && suppressed.alarmGroup.status === 'suppressed');

    const overview = await (await fetch(`${BASE}/api/overview`)).json();
    check('总览含设备/告警/事件统计',
      overview.equipmentByStatus?.length > 0 &&
      Array.isArray(overview.alarmsByStatusSeverity));

    const series = await (await fetch(
      `${BASE}/api/readings?equipmentId=${eqId}&pollutant=dust&hours=24`,
    )).json();
    check('历史曲线可查询', series.length > 0, `${series.length} 点`);
  } finally {
    server.kill('SIGTERM');
    await sleep(1500);
    await pg.stop();
  }

  if (failures) {
    console.error(`\n冒烟失败 ${failures} 项`);
    process.exit(1);
  }
  console.log('\n冒烟全部通过 🎉');
  process.exit(0);
}

main().catch((err) => {
  console.error('冒烟异常:', err);
  process.exit(1);
});
