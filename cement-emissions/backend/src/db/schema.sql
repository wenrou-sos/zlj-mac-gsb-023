-- 水泥生产排放监测平台 数据库结构 (PostgreSQL 13+)

-- 设备/排放监测点
CREATE TABLE IF NOT EXISTS equipment (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  location    TEXT,
  status      TEXT NOT NULL DEFAULT 'running'
              CHECK (status IN ('running','maintenance','stopped','fault')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 排放限值（equipment_id 为 NULL 时表示全局限值）
CREATE TABLE IF NOT EXISTS thresholds (
  id            SERIAL PRIMARY KEY,
  equipment_id  INTEGER REFERENCES equipment(id) ON DELETE CASCADE,
  pollutant     TEXT NOT NULL CHECK (pollutant IN ('dust','nox','so2')),
  warning       NUMERIC(12,3) NOT NULL,
  critical      NUMERIC(12,3) NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (equipment_id, pollutant)
);

-- 排放监测读数，单位 mg/Nm3
CREATE TABLE IF NOT EXISTS readings (
  id           BIGSERIAL PRIMARY KEY,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  pollutant    TEXT NOT NULL CHECK (pollutant IN ('dust','nox','so2')),
  value        NUMERIC(12,3) NOT NULL,
  unit         TEXT NOT NULL DEFAULT 'mg/Nm3',
  measured_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_readings_eq_pol_time
  ON readings (equipment_id, pollutant, measured_at DESC);

-- 告警合并组（同一设备+污染物在时间窗口内的超标告警合并为一组）
CREATE TABLE IF NOT EXISTS alarm_groups (
  id                SERIAL PRIMARY KEY,
  equipment_id      INTEGER NOT NULL REFERENCES equipment(id),
  pollutant         TEXT NOT NULL CHECK (pollutant IN ('dust','nox','so2')),
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','acknowledged','resolved','suppressed')),
  severity          TEXT NOT NULL DEFAULT 'warning'
                    CHECK (severity IN ('warning','critical')),
  peak_value        NUMERIC(12,3) NOT NULL,
  latest_value      NUMERIC(12,3) NOT NULL,
  first_alarm_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_alarm_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  alarm_count       INTEGER NOT NULL DEFAULT 1,
  event_id          INTEGER,
  suppression_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_alarm_groups_status ON alarm_groups (status);
CREATE INDEX IF NOT EXISTS idx_alarm_groups_eq_pol
  ON alarm_groups (equipment_id, pollutant);

-- 单条超标告警（归属于合并组）
CREATE TABLE IF NOT EXISTS alarms (
  id            BIGSERIAL PRIMARY KEY,
  group_id      INTEGER NOT NULL REFERENCES alarm_groups(id) ON DELETE CASCADE,
  equipment_id  INTEGER NOT NULL REFERENCES equipment(id),
  pollutant     TEXT NOT NULL,
  value         NUMERIC(12,3) NOT NULL,
  limit_value   NUMERIC(12,3) NOT NULL,
  level         TEXT NOT NULL CHECK (level IN ('warning','critical')),
  reading_id    BIGINT REFERENCES readings(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alarms_group ON alarms (group_id);

-- 超标处置事件
CREATE TABLE IF NOT EXISTS events (
  id            SERIAL PRIMARY KEY,
  alarm_group_id INTEGER NOT NULL UNIQUE REFERENCES alarm_groups(id),
  equipment_id  INTEGER NOT NULL REFERENCES equipment(id),
  pollutant     TEXT NOT NULL,
  severity      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','dispatched','handling','resolved','closed')),
  peak_value    NUMERIC(12,3) NOT NULL,
  handler       TEXT,
  resolution    TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  closed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_events_status ON events (status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_alarm_groups_event'
  ) THEN
    ALTER TABLE alarm_groups
      ADD CONSTRAINT fk_alarm_groups_event
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 事件处置过程记录
CREATE TABLE IF NOT EXISTS event_actions (
  id          SERIAL PRIMARY KEY,
  event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN
              ('created','dispatch','handle','resolve','close','assign','comment')),
  from_status TEXT,
  to_status   TEXT,
  actor       TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_actions_event ON event_actions (event_id, created_at);
