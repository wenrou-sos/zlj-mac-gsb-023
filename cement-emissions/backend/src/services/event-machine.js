/**
 * 超标事件处置状态机（纯函数）。
 *
 * open(待派单) -> dispatched(已派单) -> handling(处置中) -> resolved(已处置) -> closed(已归档)
 * 允许从 open 直接进入 handling（现场自行处置）。
 */

export const EVENT_TRANSITIONS = {
  open: ['dispatched', 'handling', 'closed'],
  dispatched: ['handling', 'open', 'closed'],
  handling: ['resolved', 'dispatched', 'closed'],
  resolved: ['closed', 'handling'],
  closed: [],
};

export const ACTION_LABEL = {
  created: '创建事件',
  dispatch: '派单',
  handle: '开始处置',
  resolve: '处置完成',
  close: '归档关闭',
  assign: '指派负责人',
  comment: '备注',
};

export function canTransition(from, to) {
  return (EVENT_TRANSITIONS[from] || []).includes(to);
}

/**
 * 推进事件状态，非法流转抛错
 * @returns {{status:string, action:string}}
 */
export function transition(event, to, action) {
  if (!event) throw new Error('事件不存在');
  if (event.status === to) {
    throw new Error(`事件已处于「${to}」状态，无需重复操作`);
  }
  if (!canTransition(event.status, to)) {
    throw new Error(`不允许从「${event.status}」流转到「${to}」`);
  }
  return { status: to, action: action || actionFor(event.status, to) };
}

export function actionFor(from, to) {
  if (to === 'dispatched') return 'dispatch';
  if (to === 'handling') return 'handle';
  if (to === 'resolved') return 'resolve';
  if (to === 'closed') return 'close';
  return 'comment';
}

/**
 * resolved 状态必须填写处置说明
 */
export function requireResolution(to, resolution) {
  if (to === 'resolved' && !(resolution && resolution.trim())) {
    throw new Error('处置完成时必须填写处置措施说明');
  }
}
