-- 水泥生产排放监测平台数据库结构
CREATE TABLE IF NOT EXISTS monitoring_points (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(50) UNIQUE NOT NULL,
  name        VARCHAR(100) NOT NULL,
  location    VARCHAR(200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equipment (
  id                  SERIAL PRIMARY KEY,
  code                VARCHAR(50) UNIQUE NOT NULL,
  name                VARCHAR(100) NOT NULL,
  type                VARCHAR(50) NOT NULL,             -- kiln / cooler / mill / dust_collector / denitration
  monitoring_point_id INTEGER REFERENCES monitoring_points(id),
  status              VARCHAR(20) NOT NULL DEFAULT 'running',  -- running / maintenance / offline / fault
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emission_data (
  id                  BIGSERIAL PRIMARY KEY,
  monitoring_point_id INTEGER NOT NULL REFERENCES monitoring_points(id),
  pollutant           VARCHAR(20) NOT NULL,             -- dust / nox / so2
  value               NUMERIC(10,2) NOT NULL,
  unit                VARCHAR(20) NOT NULL DEFAULT 'mg/m3',
  measured_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emission_point_time
  ON emission_data (monitoring_point_id, pollutant, measured_at DESC);

-- 告警组：合并窗口内同监测点同污染物的连续告警
CREATE TABLE IF NOT EXISTS alarm_groups (
  id                  SERIAL PRIMARY KEY,
  monitoring_point_id INTEGER NOT NULL REFERENCES monitoring_points(id),
  pollutant           VARCHAR(20) NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'active',   -- active / closed
  severity            VARCHAR(20) NOT NULL DEFAULT 'warning',  -- warning / major / critical
  alarm_count         INTEGER NOT NULL DEFAULT 0,
  max_value           NUMERIC(10,2),
  limit_value         NUMERIC(10,2),
  first_alarm_at      TIMESTAMPTZ,
  last_alarm_at       TIMESTAMPTZ,
  exempt              BOOLEAN NOT NULL DEFAULT FALSE,          -- 设备停运/检修期间免考核
  equipment_status    VARCHAR(20),                             -- 告警时关联设备状态快照
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alarm_groups_active
  ON alarm_groups (monitoring_point_id, pollutant, status);

CREATE TABLE IF NOT EXISTS alarms (
  id                  BIGSERIAL PRIMARY KEY,
  group_id            INTEGER NOT NULL REFERENCES alarm_groups(id),
  monitoring_point_id INTEGER NOT NULL REFERENCES monitoring_points(id),
  pollutant           VARCHAR(20) NOT NULL,
  value               NUMERIC(10,2) NOT NULL,
  limit_value         NUMERIC(10,2) NOT NULL,
  severity            VARCHAR(20) NOT NULL,
  message             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alarms_group ON alarms (group_id);

-- 超标事件：由告警组触发，走处置流程
CREATE TABLE IF NOT EXISTS exceedance_events (
  id                  SERIAL PRIMARY KEY,
  event_no            VARCHAR(50) UNIQUE NOT NULL,
  alarm_group_id      INTEGER NOT NULL REFERENCES alarm_groups(id),
  monitoring_point_id INTEGER NOT NULL REFERENCES monitoring_points(id),
  pollutant           VARCHAR(20) NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending / processing / resolved
  max_value           NUMERIC(10,2),
  limit_value         NUMERIC(10,2),
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS handling_records (
  id          SERIAL PRIMARY KEY,
  event_id    INTEGER NOT NULL REFERENCES exceedance_events(id),
  action      VARCHAR(50) NOT NULL,   -- claim / investigate / measure / resolve
  operator    VARCHAR(100) NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_handling_event ON handling_records (event_id);
