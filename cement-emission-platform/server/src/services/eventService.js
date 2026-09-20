'use strict';

/**
 * 超标事件处置状态机：
 *   pending --claim--> processing --resolve--> resolved
 *   processing --investigate/measure--> processing（追加处置记录）
 */
const TRANSITIONS = {
  claim: { from: ['pending'], to: 'processing', label: '认领' },
  investigate: { from: ['processing'], to: 'processing', label: '原因排查' },
  measure: { from: ['processing'], to: 'processing', label: '采取措施' },
  resolve: { from: ['processing'], to: 'resolved', label: '办结' },
};

const ACTIONS = Object.keys(TRANSITIONS);

/** 纯函数：计算处置动作后的状态，非法流转抛错 */
function nextStatus(currentStatus, action) {
  const rule = TRANSITIONS[action];
  if (!rule) {
    throw Object.assign(new Error(`不支持的处置动作: ${action}`), { status: 400 });
  }
  if (!rule.from.includes(currentStatus)) {
    throw Object.assign(
      new Error(`事件当前状态为 ${currentStatus}，不能执行 ${action}`),
      { status: 409 }
    );
  }
  return rule.to;
}

/** 执行处置：校验状态机、写入处置记录、更新事件状态 */
async function handleEvent(client, eventId, { action, operator, note }) {
  if (!operator || !operator.trim()) {
    throw Object.assign(new Error('处置人不能为空'), { status: 400 });
  }
  const found = await client.query(
    'SELECT * FROM exceedance_events WHERE id = $1 FOR UPDATE', [eventId]);
  if (found.rows.length === 0) {
    throw Object.assign(new Error('超标事件不存在'), { status: 404 });
  }
  const event = found.rows[0];
  const to = nextStatus(event.status, action);

  await client.query(
    `INSERT INTO handling_records (event_id, action, operator, note) VALUES ($1,$2,$3,$4)`,
    [eventId, action, operator.trim(), note || null]
  );

  const updated = await client.query(
    `UPDATE exceedance_events
        SET status = $2, ended_at = CASE WHEN $2 = 'resolved' THEN now() ELSE ended_at END
      WHERE id = $1 RETURNING *`,
    [eventId, to]
  );
  return updated.rows[0];
}

module.exports = { TRANSITIONS, ACTIONS, nextStatus, handleEvent };
