import { Router } from 'express';
import * as repo from '../services/repository.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const rows = await repo.listAlarmGroups({
      status: req.query.status,
      equipmentId: req.query.equipmentId ? Number(req.query.equipmentId) : undefined,
      limit: Math.min(Number(req.query.limit) || 100, 500),
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const group = await repo.getAlarmGroup(Number(req.params.id));
    if (!group) return res.status(404).json({ error: '告警组不存在' });
    const alarms = await repo.listAlarmsByGroup(group.id);
    res.json({ ...group, alarms });
  } catch (err) {
    next(err);
  }
});

// 确认告警组（值班人员已知晓）
router.post('/:id/acknowledge', async (req, res, next) => {
  try {
    const row = await repo.acknowledgeGroup(
      Number(req.params.id),
      req.body?.actor || 'operator',
    );
    if (!row) {
      return res.status(409).json({ error: '告警组不存在或已不在 active 状态' });
    }
    res.json(row);
  } catch (err) {
    next(err);
  }
});

export default router;
