import { defineConfig } from 'vitest/config';

// 集成测试使用 embedded-postgres 启动的真实 PostgreSQL 实例（端口 5433）。
// 单元测试不连接数据库。
export default defineConfig({
  test: {
    env: {
      DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5433/cement_test',
      SEED_ON_START: 'false',
    },
    globalSetup: ['./tests/setup/global-setup.js'],
    setupFiles: ['./tests/setup/each-suite.js'],
    include: ['tests/**/*.test.js'],
    // 所有测试文件共享同一个嵌入式 PG 实例，串行执行避免相互干扰
    fileParallelism: false,
    hookTimeout: 60000,
    testTimeout: 30000,
  },
});
