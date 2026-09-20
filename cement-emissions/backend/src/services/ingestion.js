import { config } from '../config.js';
import { withTransaction } from '../db/pool.js';
import * as repo from './repository.js';
import {
  evaluateLevel,
  isSuppressedByEquipment,
  shouldMerge,
  mergeIntoGroup,
  shouldAutoResolve,
} from './alarm-engine.js';
import { escalateSeverity } from './alarm-engine.js';

/**
 * 处理一条排放读数：落库 -> 限值判定 -> 告警合并 / 自动消解 -> 事件联动。
 * 全程单事务，保证读数、告警组、事件一致性。
 *
 * @returns {Promise<{reading:object, level:string, alarmGroup?:object, merged:boolean, event?:object}>}
 */
export async function ingestReading({ equipmentId, pollutant, value, measuredAt }) {
  return withTransaction(async (client) => {
    const equipment = await repo
      .getEquipment(equipmentId)
      .catch(() => null);
    if (!equipment) {
      const e = new Error(`设备 #${equipmentId} 不存在`);
      e.status = 404;
      throw e;
    }

    const reading = await repo.insertReading(client, {
      equipmentId,
      pollutant,
      value,
      measuredAt,
    });
    const at = reading.measured_at;

    const threshold = await repo.getThreshold(equipmentId, pollutant);
    const level = evaluateLevel(Number(value), threshold);
    const openGroup = await repo.findOpenGroup(client, equipmentId, pollutant);

    // 1) 正常读数：自动消解仍开启的告警组，并联动关闭对应事件
    if (level === 'ok') {
      if (shouldAutoResolve(openGroup, at)) {
        await repo.resolveGroup(client, openGroup.id);
        // 确认仅表示值班员已知晓；监测值恢复后事件同样自动消解
        if (openGroup.event_id) {
          await autoResolveEvent(client, openGroup.event_id, '监测值已恢复至限值以内，系统自动消解');
        }
      }
      return { reading, level, alarmGroup: openGroup || null, merged: false };
    }

    // 2) 超标但设备处于停机/检修：抑制告警，不产生事件
    if (isSuppressedByEquipment(equipment.status)) {
      const group = await repo.createSuppressedGroup(client, {
        equipmentId,
        pollutant,
        level,
        value,
        measuredAt: at,
        reason: `设备处于${equipment.status === 'maintenance' ? '检修' : '停机'}状态，告警抑制`,
      });
      await repo.insertAlarm(client, {
        groupId: group.id,
        equipmentId,
        pollutant,
        value,
        limitValue: threshold[level],
        level,
        readingId: reading.id,
      });
      return { reading, level, alarmGroup: group, merged: false, suppressed: true };
    }

    // 3) 时间窗口内合并，否则新开告警组并创建处置事件
    let group;
    let merged = false;
    if (shouldMerge(openGroup, at, config.mergeWindowMs)) {
      const updated = mergeIntoGroup(openGroup, Number(value), level, at);
      group = await repo.updateGroupMerged(client, updated);
      merged = true;
    } else {
      const created = await client
        .query(
          `INSERT INTO alarm_groups
             (equipment_id, pollutant, status, severity, peak_value, latest_value,
              first_alarm_at, last_alarm_at, alarm_count)
           VALUES ($1,$2,'active',$3,$4,$4,$5,$5,1) RETURNING *`,
          [equipmentId, pollutant, level, value, at],
        )
        .then((r) => r.rows[0]);
      group = created;

      const event = await repo.createEvent(client, {
        groupId: group.id,
        equipmentId,
        pollutant,
        severity: level,
        peakValue: value,
      });
      await repo.bindEventToGroup(client, group.id, event.id);
      await repo.addAction(client, {
        eventId: event.id,
        action: 'created',
        toStatus: 'open',
        note: `${pollutant} 超标触发，当前值 ${value} mg/Nm³（${level === 'critical' ? '严重' : '预警'}限值 ${threshold[level]}）`,
      });
      group.event_id = event.id;
    }

    await repo.insertAlarm(client, {
      groupId: group.id,
      equipmentId,
      pollutant,
      value,
      limitValue: threshold[level],
      level,
      readingId: reading.id,
    });

    // 合并后若严重度升级，同步升级关联事件
    let event = null;
    if (merged && group.event_id) {
      const existing = await client
        .query(`SELECT * FROM events WHERE id = $1`, [group.event_id])
        .then((r) => r.rows[0]);
      if (existing) {
        const sev = escalateSeverity(existing.severity, level);
        if (sev !== existing.severity) {
          event = await repo.updateEvent(client, existing.id, { severity: sev, peak_value: group.peak_value });
          await repo.addAction(client, {
            eventId: existing.id,
            action: 'comment',
            actor: 'system',
            note: `合并告警升级为严重，峰值 ${group.peak_value} mg/Nm³`,
          });
        }
      }
    } else if (group.event_id) {
      // 必须使用事务内 client，否则读不到尚未提交的事件
      event = await client
        .query(`SELECT * FROM events WHERE id = $1`, [group.event_id])
        .then((r) => r.rows[0]);
    }

    return { reading, level, alarmGroup: group, merged, event };
  });
}

async function autoResolveEvent(client, eventId, note) {
  const ev = await client
    .query(`SELECT * FROM events WHERE id = $1`, [eventId])
    .then((r) => r.rows[0]);
  if (!ev || ev.status === 'resolved' || ev.status === 'closed') return;
  await repo.updateEvent(client, eventId, {
    status: 'resolved',
    resolution: note,
    resolved_at: new Date(),
  });
  await repo.addAction(client, {
    eventId,
    action: 'resolve',
    fromStatus: ev.status,
    toStatus: 'resolved',
    actor: 'system',
    note,
  });
}
