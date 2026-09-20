import { Router } from 'express';
import * as repo from '../services/repository.js';
import { ingestReading } from '../services/ingestion.js';
import { POLLUTANTS } from '../config.js';

const router = Router();

const VALID = new Set(POLLUTANTS);

router.get('/', async (req, res, next) => {
  try {
    const { equipmentId, pollutant, hours = 6, aggregate } = req.query;
    if (!equipmentId || !pollutant) {
      return res
        .status(400)
        .json({ error: 'equipmentId 与 pollutant 为必填查询参数' });
    }
    if (!VALID.has(pollutant)) {
      return res.status(400).json({ error: `污染物必须为 ${POLLUTANTS.join('/')}` });
    }
    const rows = await repo.readingSeries({
      equipmentId: Number(equipmentId),
      pollutant,
      hours: Math.min(Number(hours) || 6, 168),
      aggregate,
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/latest', async (_req, res, next) => {
  try {
    res.json(await repo.latestReadings());
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { equipmentId, pollutant, value, measuredAt } = req.body || {};
    if (!equipmentId || !pollutant || value === undefined) {
      return res
        .status(400)
        .json({ error: 'equipmentId、pollutant、value 必填' });
    }
    if (!VALID.has(pollutant)) {
      return res.status(400).json({ error: `污染物必须为 ${POLLUTANTS.join('/')}` });
    }
    const num = Number(value);
    if (Number.isNaN(num) || num < 0) {
      return res.status(400).json({ error: 'value 必须为非负数字' });
    }
    const result = await ingestReading({
      equipmentId: Number(equipmentId),
      pollutant,
      value: num,
      measuredAt: measuredAt ? new Date(measuredAt) : undefined,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
