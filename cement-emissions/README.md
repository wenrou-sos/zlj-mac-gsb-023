# 水泥生产排放监测平台

面向水泥生产线的大气污染物连续在线监测（CEMS）平台，实时展示 **粉尘、氮氧化物（NOx）、二氧化硫（SO₂）** 排放数据，支持**告警合并**、**超标事件闭环处置**与**设备状态关联抑制**。

技术栈：**Vue 3 + Vite + Chart.js**（前端） · **Node.js + Express**（后端） · **PostgreSQL**（数据库），全栈 Docker 化并提供一键启动脚本。

---

## ✨ 核心能力

### 1. 三类污染物实时监测
- 设备 × 污染物实时值矩阵，按预警/严重两级限值自动变色
- 排放趋势曲线（原始值 / 5 分钟 / 小时聚合），图上叠加预警、严重限值线
- 均值、峰值、超标点数统计；开机自动生成 24 小时历史数据

### 2. 告警合并（防告警风暴）
- 同一设备 + 同一污染物，在 **10 分钟合并窗口**（`ALARM_MERGE_WINDOW_MS` 可调）内的重复超标自动归入同一**告警组**
- 告警组聚合：首末告警时间、峰值、最新值、累计次数、最高严重度（只升不降）
- 读数恢复正常后告警组自动消解；告警列表显示"合并减少 N 条重复告警"

### 3. 超标事件闭环处置
- 新告警组自动创建超标处置事件，状态机：
  `待派单 open → 已派单 dispatched → 处置中 handling → 已处置 resolved → 已归档 closed`
  （允许 open 直接处置、处置后退回补充）
- 指派负责人、派单、处置（**完成时强制填写处置措施**）、归档、追加备注
- 完整处置时间线；合并进来的新读数若升至 critical，事件严重度自动升级
- 非法状态流转被服务端拒绝并返回 400

### 4. 设备状态关联
- 设备四态：运行 / 检修 / 停机 / 故障
- **停机、检修期间的超标读数只入库并标记为"已抑制"告警，不产生处置事件**；恢复运行后恢复正常告警
- 故障状态仍照常告警（提示重点排查）
- 事件详情页可直接联动切换设备状态

---

## 🚀 一键启动

```bash
./start.sh
```

脚本会自动探测环境：

| 命令 | 说明 |
| --- | --- |
| `./start.sh` | 有 Docker 用 Docker Compose，否则用本地嵌入式模式 |
| `./start.sh docker` | 强制 Docker：启动 postgres + backend + frontend(nginx) 三容器 |
| `./start.sh local` | 本地模式：Node + **嵌入式 PostgreSQL**（无需系统安装 PG/Docker） |
| `./start.sh local --fresh` | 本地模式并重置数据库 |
| `./start.sh stop` | 停止服务 |
| `./start.sh logs` | 查看 Docker 日志 |
| `./start.sh test` | 运行前后端全部测试 |

启动后：

- **监测平台**：http://localhost:8080
- **API 健康检查**：http://localhost:4000/api/health
- 默认开启实时数据模拟（每 5 秒上报，约 12% 概率出现超标脉冲），便于直接体验完整流程

环境变量可复制 `.env.example` 为 `.env` 修改（端口、数据库账号、合并窗口、模拟开关等）。

### 手动 Docker 方式

```bash
docker compose up -d --build
# frontend:  http://localhost:8080  (nginx 反代 /api -> backend)
# backend:   http://localhost:4000
# postgres:  localhost:5432
```

### 本地开发（不用脚本）

```bash
# 终端 1：嵌入式 PostgreSQL
cd backend && npm install && npm run pg:start
# 终端 2：后端（自动建表 + 种子数据 + 可选实时模拟）
cd backend && npm run simulate
# 终端 3：前端
cd frontend && npm install && npm run dev
```

---

## 🧪 测试

- **后端**：Vitest + `embedded-postgres`（测试时自动拉起**真实 PostgreSQL 17**，非 Mock）+ supertest
  - 单元：限值判定、合并窗口边界、聚合规则、抑制规则、事件状态机（32 例）
  - 集成：读数摄入全流程、合并/消解/抑制、事件处置时间线、全部 HTTP 接口（45 例）
  - 另有独立端到端冒烟脚本 `node tests/smoke/run-smoke.mjs`
- **前端**：Vitest + @vue/test-utils + jsdom（工具函数、业务常量、状态徽标、事件列表交互）

```bash
./start.sh test
# 或分别执行
(cd backend && npm test)
(cd frontend && npm test && npm run build)
```

当前结果：**后端 77 例、前端 18 例全部通过**。

---

## 📁 目录结构

```
cement-emissions/
├── docker-compose.yml          # postgres + backend + frontend 编排
├── start.sh                    # 一键启动/停止/测试脚本
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── src/
│   │   ├── config.js           # 配置与污染物元数据
│   │   ├── app.js              # Express 应用与路由装配
│   │   ├── server.js           # 入口：建表/种子/模拟/优雅退出
│   │   ├── db/
│   │   │   ├── schema.sql      # 全部表结构（约束/索引/循环外键）
│   │   │   ├── pool.js         # 连接池与事务封装
│   │   │   └── migrate.js
│   │   ├── routes/             # equipment/readings/alarms/events
│   │   └── services/
│   │       ├── alarm-engine.js # 纯函数：判定/合并/抑制/消解规则
│   │       ├── event-machine.js# 纯函数：事件处置状态机
│   │       ├── ingestion.js    # 读数摄入事务（判定→合并→事件联动）
│   │       ├── event-service.js# 事件流转/指派/备注
│   │       ├── repository.js   # 数据访问
│   │       ├── seed.js         # GB 4915 限值 + 设备 + 24h 历史
│   │       ├── simulator.js    # CEMS 实时上报模拟
│   │       └── overview.js     # 总览聚合统计
│   ├── scripts/pg-local.mjs    # 嵌入式 PG 管理
│   └── tests/                  # unit / integration / smoke
└── frontend/
    ├── Dockerfile + nginx.conf
    ├── src/
    │   ├── views/              # 总览/趋势/告警/事件列表/事件详情/设置
    │   ├── components/         # 导航、状态徽标、污染物曲线
    │   ├── composables/        # 轮询
    │   ├── api/  constants.js  # 与后端状态机一致的前端映射
    │   └── utils/
    └── tests/unit/
```

## 🔌 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/overview` | 总览统计（设备/告警/事件/今日峰值） |
| GET/PATCH | `/api/equipment`、`/api/equipment/:id/status` | 设备与状态切换 |
| GET/PUT | `/api/thresholds` | 全局/设备专属两级限值 |
| GET/POST | `/api/readings` | 历史曲线（支持聚合）/ 上报读数（触发告警引擎） |
| GET | `/api/readings/latest` | 各设备各污染物最新值 |
| GET | `/api/alarms`、`/api/alarms/:id`、`POST /api/alarms/:id/acknowledge` | 合并告警组 |
| GET | `/api/events`、`/api/events/:id` | 事件与详情（时间线+关联告警） |
| POST | `/api/events/:id/transition` `/assign` `/comments` | 处置流转 |

详细字段见 [API.md](./API.md)。

## 📐 数据模型要点

- `readings` 原始读数 → `alarms` 单条超标告警（N 条）→ `alarm_groups` 合并组（1 组）→ `events` 处置事件（1:1）→ `event_actions` 过程留痕
- 全链路数据库 CHECK 约束保障状态/污染物枚举合法；摄入与状态流转使用数据库事务，保证读数、告警组、事件一致
- 默认限值参考 GB 4915-2013《水泥工业大气污染物排放标准》：粉尘 25/30、NOx 280/320、SO₂ 170/200 mg/Nm³（预警/严重，可在界面调整）
