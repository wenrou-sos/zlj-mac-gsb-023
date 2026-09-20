# 水泥生产排放监测平台

面向水泥生产企业的废气排放监测系统，覆盖 **粉尘、氮氧化物（NOx）、二氧化硫（SO₂）** 三项指标，
支持 **告警合并**、**超标事件处置闭环** 与 **设备状态关联（免考核）**。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + Vite + Vue Router + ECharts + Axios |
| 后端 | Node.js 20 + Express + pg |
| 数据库 | PostgreSQL 16 |
| 测试 | Jest + Supertest + pg-mem（后端 52 例）、Vitest（前端 12 例） |
| 部署 | Docker + Docker Compose，一键启动脚本 |

## 快速开始

### 方式一：Docker 一键启动（推荐）

```bash
./start.sh
```

启动后访问：

- 前端界面：http://localhost:8080
- 后端 API：http://localhost:3000/api
- 健康检查：http://localhost:3000/api/health

首次启动自动建表并写入演示数据；内置数据发生器每 10 秒产生一批模拟监测数据
（约 6% 概率超标，可观察告警合并与事件生成的完整过程）。

### 方式二：本地开发

```bash
# 1. 准备 PostgreSQL，创建数据库与用户（或使用 docker 仅启动 db）
docker compose up -d db

# 2. 后端（自动建表 + 演示数据）
cd server && npm install
PGHOST=localhost PGUSER=cement PGPASSWORD=cement123 PGDATABASE=cement_emission npm start

# 3. 前端（开发服务器已配置 /api 代理）
cd web && npm install && npm run dev   # http://localhost:5173
```

### 运行测试

```bash
cd server && npm test   # 后端：单元 + API + pg-mem 真实 SQL 集成测试
cd web && npm test      # 前端：工具函数与业务规则测试
```

## 核心业务规则

### 1. 告警合并
- 排放数据超过限值（GB 4915-2013 重点地区限值：粉尘 20 / NOx 320 / SO₂ 100 mg/m³）即产生告警；
- **同一监测点 + 同一污染物** 在 **30 分钟合并窗口**（`ALARM_MERGE_WINDOW_MINUTES`）内的连续告警自动并入同一告警组；
- 告警组维护：合并条数、峰值、最高级别（一般/较重/严重，按 1.2x / 1.5x 限值划分）、首末警时间；
- 超出合并窗口或数据恢复后，新告警开启新组。

### 2. 超标事件处置
- 告警组内告警数达到阈值（默认 3 条，`EVENT_THRESHOLD_COUNT`）自动生成超标事件；
- 处置状态机：`待处置 → 处置中 → 已办结`，动作：认领 / 原因排查 / 采取措施 / 办结；
- 非法流转（如待处置直接办结、办结后再处置）返回 409；
- 每次处置记录处置人、动作、说明，形成完整处置时间线。

### 3. 设备状态关联
- 设备状态：运行 / 检修 / 停运 / 故障；
- 设备转入 **检修/停运** 时：该监测点的活动告警组自动关闭并标记 **免考核**；
- 检修/停运期间新产生的超标告警自动关联设备状态快照并标记免考核，**不再生成超标事件**；
- 事件详情页展示关联设备当前状态，辅助处置决策。

## API 概览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/overview` | 驾驶舱汇总（最新值/告警/事件/设备统计） |
| GET | `/api/emissions` | 排放时序数据（pointId/pollutant/from/to 过滤） |
| POST | `/api/emissions` | 上报监测数据（触发告警判定与合并） |
| GET | `/api/alarms/groups` | 告警组列表（分页、状态/污染物过滤） |
| GET | `/api/alarms/groups/:id` | 告警组明细（含每条原始告警） |
| POST | `/api/alarms/groups/:id/close` | 人工关闭告警组 |
| GET | `/api/events` | 超标事件列表 |
| GET | `/api/events/:id` | 事件详情（处置记录+告警组+关联设备） |
| POST | `/api/events/:id/handle` | 处置事件 `{action, operator, note}` |
| GET | `/api/equipment` | 设备列表（含活动告警组数） |
| PUT | `/api/equipment/:id/status` | 变更设备状态（联动免考核） |

## 项目结构

```
├── docker-compose.yml      # 三服务编排（db / server / web）
├── start.sh                # 一键启动脚本
├── server/                 # 后端
│   ├── Dockerfile
│   ├── src/
│   │   ├── index.js        # 启动：等待 DB → 建表 → 种子数据 → HTTP 服务
│   │   ├── app.js          # Express 应用与统一错误处理
│   │   ├── schema.sql      # 数据库结构
│   │   ├── seed.js         # 演示数据
│   │   ├── simulator.js    # 模拟数据发生器
│   │   ├── services/       # 告警合并 / 事件状态机 / 设备联动（纯函数可测）
│   │   └── routes/         # REST 路由
│   └── tests/              # Jest：单元 / API / pg-mem 集成测试
└── web/                    # 前端
    ├── Dockerfile          # 多阶段构建 → Nginx
    ├── nginx.conf          # SPA 回退 + /api 反代
    ├── src/views/          # 监测总览 / 告警管理 / 超标事件 / 设备状态
    └── tests/              # Vitest
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | 3000 | 后端端口 |
| `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` | localhost/5432/cement/cement123/cement_emission | 数据库连接 |
| `ALARM_MERGE_WINDOW_MINUTES` | 30 | 告警合并窗口（分钟） |
| `EVENT_THRESHOLD_COUNT` | 3 | 触发超标事件的组内告警数 |
| `SIMULATOR_ENABLED` | false（compose 中为 true） | 是否启动模拟数据发生器 |
| `SIMULATOR_INTERVAL_MS` | 10000 | 模拟数据间隔 |
