import express from 'express';
import equipmentRouter from './routes/equipment.js';
import readingsRouter from './routes/readings.js';
import alarmsRouter from './routes/alarms.js';
import eventsRouter from './routes/events.js';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) =>
    res.json({ status: 'ok', time: new Date().toISOString() }),
  );

  app.use('/api', equipmentRouter);
  app.use('/api/readings', readingsRouter);
  app.use('/api/alarms', alarmsRouter);
  app.use('/api/events', eventsRouter);

  app.use((req, res) => res.status(404).json({ error: '接口不存在' }));

  // 统一错误处理：状态机校验错误返回 400，其余 500
  app.use((err, _req, res, _next) => {
    const status = err.status || 400;
    if (status >= 500) console.error('[api]', err);
    res.status(status).json({ error: err.message || '服务器内部错误' });
  });

  return app;
}
