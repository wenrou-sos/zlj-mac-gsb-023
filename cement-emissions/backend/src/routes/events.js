import { Router } from 'express';
import * as repo from '../services/repository.js';
import {
  advanceEvent,
  assignEvent,
  commentEvent,
} from '../services/event-service.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const rows = await repo.listEvents({
      status: req.query.status,
      equipmentId: req.query.equipmentId
        ? Number(req.query.equipmentId)
        : undefined,
      limit: Math.min(Number(req.query.limit) || 100, 500),
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const event = await repo.getEvent(Number(req.params.id));
    if (!event) return res.status(404).json({ error: '事件不存在' });
    const actions = await repo.listEventActions(event.id);
    const group = await repo.getAlarmGroup(event.alarm_group_id);
    const alarms = group ? await repo.listAlarmsByGroup(group.id) : [];
    res.json({ ...event, timeline: actions, alarmGroup: group, alarms });
  } catch (err) {
    next(err);
  }
});

// 状态流转：dispatch / handle / resolve / close
router.post('/:id/transition', async (req, res, next) => {
  try {
    const { toStatus, actor, note, resolution, handler } = req.body || {};
    if (!toStatus) return res.status(400).json({ error: 'toStatus 必填' });
    const row = await advanceEvent(Number(req.params.id), {
      toStatus,
      actor,
      note,
      resolution,
      handler,
    });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/assign', async (req, res, next) => {
  try {
    const { handler, actor, note } = req.body || {};
    if (!handler) return res.status(400).json({ error: 'handler 必填' });
    res.json(await assignEvent(Number(req.params.id), { handler, actor, note }));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/comments', async (req, res, next) => {
  try {
    const { actor, note } = req.body || {};
    if (!note) return res.status(400).json({ error: 'note 必填' });
    res.status(201).json(await commentEvent(Number(req.params.id), { actor, note }));
  } catch (err) {
    next(err);
  }
});

export default router;
