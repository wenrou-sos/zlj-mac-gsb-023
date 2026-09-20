'use strict';

const express = require('express');
const cors = require('cors');

const emissionsRouter = require('./routes/emissions');
const alarmsRouter = require('./routes/alarms');
const eventsRouter = require('./routes/events');
const equipmentRouter = require('./routes/equipment');
const overviewRouter = require('./routes/overview');
const db = require('./db');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', db: 'up' });
    } catch (err) {
      res.status(503).json({ status: 'degraded', db: 'down' });
    }
  });

  app.get('/api/monitoring-points', async (req, res, next) => {
    try {
      const { rows } = await db.query('SELECT * FROM monitoring_points ORDER BY id');
      res.json({ data: rows });
    } catch (err) { next(err); }
  });

  app.use('/api/emissions', emissionsRouter);
  app.use('/api/alarms', alarmsRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/equipment', equipmentRouter);
  app.use('/api/overview', overviewRouter);

  app.use((req, res) => res.status(404).json({ error: '接口不存在' }));

  // 统一错误处理：业务错误带 status，其余为 500
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message || '服务器内部错误' });
  });

  return app;
}

module.exports = { createApp };
