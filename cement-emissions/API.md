# API 说明

基础路径：`/api`，所有请求/响应均为 JSON。错误响应统一为 `{ "error": "..." }`，
状态码：400 参数/状态流转错误、404 资源不存在、409 状态冲突。

## 健康检查

### GET /api/health
```json
{ "status": "ok", "time": "2026-09-19T16:00:00.000Z" }
```

## 总览

### GET /api/overview
返回设备状态分布、告警按状态×严重度统计、事件按状态统计、今日分污染物告警次数与峰值、
各设备各污染物最新读数。

```json
{
  "equipmentByStatus": [{ "status": "running", "count": 4 }],
  "alarmsByStatusSeverity": [{ "status": "active", "severity": "critical", "count": 2 }],
  "eventsByStatus": [{ "status": "open", "count": 1 }],
  "todayAlarms": [{ "pollutant": "dust", "count": 12, "peak": "35.20" }],
  "latestReadings": [{ "equipment_id": 1, "pollutant": "dust", "value": "12.3", "measured_at": "..." }]
}
```

## 设备

### GET /api/equipment
### PATCH /api/equipment/:id/status
请求体：`{ "status": "running" }`，status ∈ `running | maintenance | stopped | fault`。

## 限值

### GET /api/thresholds
`equipment_id` 为 null 的行是全局限值。判定时设备专属限值优先，缺省回落全局。

### PUT /api/thresholds
```json
{ "equipmentId": 1, "pollutant": "dust", "warning": 20, "critical": 25 }
```
- `equipmentId` 省略或为 null 表示全局限值
- `pollutant` ∈ `dust | nox | so2`，critical 必须大于 warning

## 读数

### GET /api/readings?equipmentId=1&pollutant=dust&hours=24&aggregate=5min
- `hours`：1–168，默认 6
- `aggregate`：省略返回原始点；`5min`（5 分钟桶）、`hour`（小时桶）返回
  `bucket / avg_value / max_value / min_value`

### GET /api/readings/latest
每个设备每种污染物的最新一条。

### POST /api/readings
**核心接口**：写入读数并执行「限值判定 → 告警合并/抑制/消解 → 事件联动」，全程单事务。
```json
{ "equipmentId": 1, "pollutant": "dust", "value": 31.5, "measuredAt": "2026-09-19T10:00:00Z" }
```
`measuredAt` 省略则取服务端当前时间。响应：

```json
{
  "reading": { "id": 123, "equipment_id": 1, "pollutant": "dust", "value": "31.500", "measured_at": "..." },
  "level": "critical",          // ok | warning | critical
  "merged": false,              // 是否合并入已有告警组
  "suppressed": false,          // 是否因停机/检修被抑制
  "alarmGroup": { "id": 7, "status": "active", "severity": "critical",
                  "alarm_count": 1, "peak_value": "31.500", "event_id": 7 },
  "event": { "id": 7, "status": "open" }
}
```

合并规则：同设备同污染物、组状态为 active/acknowledged、距组内最后告警 ≤
`ALARM_MERGE_WINDOW_MS`（默认 600000）则合并，否则新建组并自动创建 open 事件。
正常读数到达时，仍开启的告警组自动 resolved；其未被人工确认过的事件自动 resolved。

## 告警

### GET /api/alarms?status=active&equipmentId=1&limit=100
告警组列表（含设备名、设备状态、关联事件状态）。
status ∈ `active | acknowledged | resolved | suppressed`。

### GET /api/alarms/:id
告警组详情 + `alarms` 数组（组内全部单条告警，含触发值与当时限值）。

### POST /api/alarms/:id/acknowledge
`{ "actor": "值班员" }`，active → acknowledged；重复确认返回 409。

## 超标事件

### GET /api/events?status=open&equipmentId=1
### GET /api/events/:id
详情含 `timeline`（过程记录）、`alarmGroup`、`alarms`（关联合并告警明细）。

### POST /api/events/:id/transition
状态流转。请求体：
```json
{ "toStatus": "handling", "actor": "张工", "note": "到场检查", "resolution": "更换滤袋" }
```
合法流转：

| from | 可流转到 |
| --- | --- |
| open | dispatched, handling, closed |
| dispatched | handling, open, closed |
| handling | resolved, dispatched, closed |
| resolved | closed, handling |
| closed | （终态） |

- `toStatus=resolved` 时 `resolution`（或 note）为**必填**
- 非法流转返回 400，例如 `{ "error": "不允许从「open」流转到「resolved」" }`

### POST /api/events/:id/assign
`{ "handler": "张工", "actor": "调度员", "note": "..." }` 指派负责人。

### POST /api/events/:id/comments
`{ "actor": "张工", "note": "已上报环保部门" }` 追加处置备注。
