import { Router } from 'express';
import * as repo from '../services/repository.js';
import { getOverview } from '../services/overview.js';

const router = Router();

router.get('/overview', async (_req, res, next) => {
  try {
    res.json(await getOverview());
  } catch (err) {
    next(err);
  }
});

router.get('/equipment', async (_req, res, next) => {
  try {
    res.json(await repo.listEquipment());
  } catch (err) {
    next(err);
  }
});

router.patch('/equipment/:id/status', async (req, res, next) => {
  try {
    const row = await repo.updateEquipmentStatus(
      Number(req.params.id),
      req.body.status,
    );
    if (!row) return res.status(404).json({ error: '设备不存在' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.get('/thresholds', async (_req, res, next) => {
  try {
    res.json(await repo.listThresholds());
  } catch (err) {
    next(err);
  }
});

router.put('/thresholds', async (req, res, next) => {
  try {
    const { equipmentId, pollutant, warning, critical } = req.body;
    if (!pollutant || warning == null || critical == null) {
      return res.status(400).json({ error: 'pollutant/warning/critical 必填' });
    }
    if (Number(critical) <= Number(warning)) {
      return res
        .status(400)
        .json({ error: '严重限值必须大于预警限值' });
    }
    const row = await repo.upsertThreshold({
      equipmentId: equipmentId ?? null,
      pollutant,
      warning: Number(warning),
      critical: Number(critical),
    });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

export default router;
