'use strict';

const { EQUIPMENT_STATUS } = require('../utils/standards');

/** 更新设备状态；转入检修/停运时，关闭该监测点的活动告警组（标记免考核） */
async function updateEquipmentStatus(client, equipmentId, status) {
  if (!EQUIPMENT_STATUS.includes(status)) {
    throw Object.assign(new Error(`非法设备状态: ${status}`), { status: 400 });
  }
  const found = await client.query('SELECT * FROM equipment WHERE id = $1', [equipmentId]);
  if (found.rows.length === 0) {
    throw Object.assign(new Error('设备不存在'), { status: 404 });
  }
  const updated = await client.query(
    'UPDATE equipment SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [equipmentId, status]
  );
  const equipment = updated.rows[0];

  let closedGroups = [];
  if (['maintenance', 'offline'].includes(status) && equipment.monitoring_point_id) {
    const res = await client.query(
      `UPDATE alarm_groups
          SET status = 'closed', exempt = TRUE, equipment_status = $2
        WHERE monitoring_point_id = $1 AND status = 'active'
        RETURNING id`,
      [equipment.monitoring_point_id, status]
    );
    closedGroups = res.rows.map((r) => r.id);
  }
  return { equipment, closedGroups };
}

module.exports = { updateEquipmentStatus };
