import * as repo from './repository.js';
import { withTransaction } from '../db/pool.js';
import { transition, requireResolution } from './event-machine.js';

/**
 * 推进超标事件处置流程，并写入过程记录
 */
export async function advanceEvent(id, { toStatus, actor, note, resolution, handler }) {
  return withTransaction(async (client) => {
    const ev = await client
      .query(`SELECT * FROM events WHERE id = $1 FOR UPDATE`, [id])
      .then((r) => r.rows[0]);
    if (!ev) {
      const e = new Error('事件不存在');
      e.status = 404;
      throw e;
    }

    requireResolution(toStatus, resolution ?? note);
    const { status, action } = transition(ev, toStatus);

    const fields = { status };
    if (handler) fields.handler = handler;
    if (status === 'resolved') {
      fields.resolution = resolution || note;
      fields.resolved_at = new Date();
    }
    if (status === 'closed') fields.closed_at = new Date();

    const updated = await repo.updateEvent(client, id, fields);
    await repo.addAction(client, {
      eventId: id,
      action,
      fromStatus: ev.status,
      toStatus: status,
      actor,
      note: resolution || note,
    });
    return updated;
  });
}

export async function assignEvent(id, { handler, actor, note }) {
  return withTransaction(async (client) => {
    const updated = await repo.updateEvent(client, id, { handler });
    await repo.addAction(client, {
      eventId: id,
      action: 'assign',
      actor,
      note: note || `指派负责人：${handler}`,
    });
    return updated;
  });
}

export async function commentEvent(id, { actor, note }) {
  return withTransaction(async (client) => {
    await repo.addAction(client, {
      eventId: id,
      action: 'comment',
      actor,
      note,
    });
    return { ok: true };
  });
}
