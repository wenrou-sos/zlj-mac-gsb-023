<template>
  <div class="layout">
    <header class="header">
      <div class="brand">
        <span class="logo">🏭</span>
        <h1>水泥生产排放监测平台</h1>
      </div>
      <nav class="nav">
        <router-link v-for="r in routes" :key="r.path" :to="r.path"
                     :class="{ active: $route.path === r.path }">
          {{ r.meta.title }}
        </router-link>
      </nav>
    </header>
    <main class="main">
      <router-view />
    </main>
  </div>
</template>

<script setup>
const routes = [
  { path: '/dashboard', meta: { title: '监测总览' } },
  { path: '/alarms', meta: { title: '告警管理' } },
  { path: '/events', meta: { title: '超标事件' } },
  { path: '/equipment', meta: { title: '设备状态' } },
];
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #f0f2f5; color: #303133; }
.layout { min-height: 100vh; }
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 24px; height: 60px; background: #1f2d3d; color: #fff;
  position: sticky; top: 0; z-index: 10;
}
.brand { display: flex; align-items: center; gap: 10px; }
.brand h1 { font-size: 18px; font-weight: 600; }
.logo { font-size: 24px; }
.nav { display: flex; gap: 4px; }
.nav a {
  color: #bfcbd9; text-decoration: none; padding: 8px 16px;
  border-radius: 6px; font-size: 14px; transition: all .2s;
}
.nav a:hover { color: #fff; background: rgba(255,255,255,.1); }
.nav a.active { color: #fff; background: #409eff; }
.main { padding: 20px 24px; max-width: 1400px; margin: 0 auto; }

.card {
  background: #fff; border-radius: 8px; padding: 16px 20px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06); margin-bottom: 16px;
}
.card h3 { font-size: 15px; margin-bottom: 12px; color: #606266; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #ebeef5; }
th { color: #909399; font-weight: 500; background: #fafafa; }
tr:hover td { background: #f5f7fa; }
.tag {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  font-size: 12px; color: #fff;
}
.btn {
  border: none; border-radius: 4px; padding: 6px 14px; font-size: 13px;
  cursor: pointer; background: #409eff; color: #fff; transition: opacity .2s;
}
.btn:hover { opacity: .85; }
.btn:disabled { background: #c0c4cc; cursor: not-allowed; }
.btn.ghost { background: #fff; color: #409eff; border: 1px solid #409eff; }
.btn.danger { background: #f56c6c; }
select, input, textarea {
  padding: 6px 10px; border: 1px solid #dcdfe6; border-radius: 4px;
  font-size: 13px; outline: none;
}
select:focus, input:focus, textarea:focus { border-color: #409eff; }
.filters { display: flex; gap: 10px; margin-bottom: 14px; align-items: center; flex-wrap: wrap; }
.muted { color: #909399; font-size: 12px; }
.error-banner {
  background: #fef0f0; color: #f56c6c; padding: 10px 14px;
  border-radius: 6px; margin-bottom: 14px; font-size: 13px;
}
</style>
