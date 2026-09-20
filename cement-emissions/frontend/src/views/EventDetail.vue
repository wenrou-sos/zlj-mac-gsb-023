<script setup>
import { ref, computed, inject, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';
import { usePolling } from '../composables/usePolling.js';
import {
  POLLUTANT_MAP,
  EVENT_STATUS,
  SEVERITY,
  EQUIPMENT_STATUS,
  EVENT_NEXT_ACTIONS,
} from '../constants.js';
import StatusBadge from '../components/StatusBadge.vue';
import { formatNumber, formatTime } from '../utils/format.js';

const props = defineProps({ id: { type: [String, Number], required: true } });
const router = useRouter();
const notify = inject('notify');

const event = ref(null);
const actionModal = ref(null);
const assignModal = ref(false);
const commentModal = ref(false);
const form = ref({ actor: '值班员', note: '', resolution: '', handler: '' });

async function load() {
  event.value = await api.getEvent(props.id);
}
const { loading, error, reload } = usePolling(load, 10000);

const nextActions = computed(() =>
  event.value ? EVENT_NEXT_ACTIONS[event.value.status] || [] : [],
);

const ACTION_LABEL = {
  created: '事件创建',
  dispatch: '派单',
  handle: '开始处置',
  resolve: '处置完成',
  close: '归档关闭',
  assign: '指派负责人',
  comment: '处置备注',
};

function openAction(action) {
  form.value = { actor: form.value.actor, note: '', resolution: '', handler: '' };
  actionModal.value = action;
}

async function submitAction() {
  const a = actionModal.value;
  try {
    await api.transitionEvent(event.value.id, {
      toStatus: a.to,
      actor: form.value.actor || '值班员',
      note: form.value.note || undefined,
      resolution: form.value.resolution || undefined,
    });
    notify(`已${ACTION_LABEL[a.action] || '操作'}`);
    actionModal.value = null;
    await reload();
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function submitAssign() {
  try {
    await api.assignEvent(event.value.id, {
      handler: form.value.handler,
      actor: form.value.actor || '值班员',
      note: form.value.note,
    });
    notify('指派成功');
    assignModal.value = false;
    await reload();
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function submitComment() {
  try {
    await api.commentEvent(event.value.id, {
      actor: form.value.actor || '值班员',
      note: form.value.note,
    });
    notify('备注已添加');
    commentModal.value = false;
    await reload();
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function setEquipmentStatus(status) {
  try {
    await api.setEquipmentStatus(event.value.equipment_id, status);
    notify('设备状态已更新');
    await reload();
  } catch (err) {
    notify(err.message, 'error');
  }
}
</script>

<template>
  <div>
    <button class="btn btn-sm" style="margin-bottom:12px" @click="router.push('/events')">
      ← 返回事件列表
    </button>

    <div v-if="error" class="card" style="color:#991b1b">加载失败：{{ error }}</div>
    <div v-else-if="!event" class="card muted">加载中…</div>

    <div v-else>
      <!-- 事件头 -->
      <div class="card" style="margin-bottom:14px">
        <div class="head">
          <div>
            <div class="title">
              超标事件 #{{ event.id }}
              <StatusBadge :map="SEVERITY" :value="event.severity" class="ml" />
              <StatusBadge :map="EVENT_STATUS" :value="event.status" class="ml" />
            </div>
            <div class="sub">
              {{ event.equipment_name }}（{{ event.equipment_code }}）·
              {{ POLLUTANT_MAP[event.pollutant].label }} ·
              峰值 <span class="danger-text">{{ formatNumber(event.peak_value) }}</span> mg/Nm³
              · 关联设备状态
              <StatusBadge :map="EQUIPMENT_STATUS" :value="event.equipment_status" class="ml" />
            </div>
          </div>
          <div class="head-actions" v-if="event.status !== 'closed'">
            <button class="btn" @click="assignModal = true">
              {{ event.handler ? '改派负责人' : '指派负责人' }}
            </button>
            <button class="btn" @click="commentModal = true">添加备注</button>
            <button
              v-for="a in nextActions"
              :key="a.to"
              class="btn"
              :class="{ 'btn-primary': a.to === 'resolved' }"
              @click="openAction(a)"
            >{{ a.label }}</button>
          </div>
        </div>

        <dl class="meta-grid">
          <div><dt>当前负责人</dt><dd>{{ event.handler || '未指派' }}</dd></div>
          <div><dt>发起时间</dt><dd>{{ formatTime(event.started_at) }}</dd></div>
          <div><dt>处置时间</dt><dd>{{ formatTime(event.resolved_at) }}</dd></div>
          <div><dt>归档时间</dt><dd>{{ formatTime(event.closed_at) }}</dd></div>
        </dl>
        <div v-if="event.resolution" class="resolution">
          <strong>处置措施：</strong>{{ event.resolution }}
        </div>

        <!-- 设备状态联动快捷操作 -->
        <div class="eq-link" v-if="event.status !== 'closed'">
          <span class="muted" style="font-size:12px">设备状态联动：</span>
          <button class="btn btn-sm" @click="setEquipmentStatus('maintenance')">转检修</button>
          <button class="btn btn-sm" @click="setEquipmentStatus('stopped')">停机</button>
          <button class="btn btn-sm" @click="setEquipmentStatus('fault')">标记故障</button>
          <button class="btn btn-sm" @click="setEquipmentStatus('running')">恢复运行</button>
          <span class="muted" style="font-size:12px;margin-left:6px">
            停机/检修期间该设备的超标告警将自动抑制
          </span>
        </div>
      </div>

      <div class="grid" style="grid-template-columns: 1fr 380px; align-items:start">
        <!-- 处置时间线 -->
        <div class="card">
          <h3>处置过程时间线</h3>
          <div class="timeline">
            <div v-for="(a, i) in event.timeline" :key="a.id" class="t-item">
              <div class="t-dot" :class="{ last: i === event.timeline.length - 1 }"></div>
              <div class="t-body">
                <div class="t-head">
                  <span class="strong">{{ ACTION_LABEL[a.action] || a.action }}</span>
                  <span v-if="a.from_status || a.to_status" class="muted" style="font-size:12px">
                    {{ EVENT_STATUS[a.from_status]?.label || '—' }}
                    → {{ EVENT_STATUS[a.to_status]?.label || '状态不变' }}
                  </span>
                </div>
                <div v-if="a.note" class="t-note">{{ a.note }}</div>
                <div class="muted" style="font-size:12px">
                  {{ a.actor || '系统' }} · {{ formatTime(a.created_at) }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 关联告警 -->
        <div class="card">
          <h3>关联合并告警（{{ event.alarms.length }} 条）</h3>
          <div class="muted" style="font-size:12px;margin-bottom:8px">
            告警组 #{{ event.alarm_group_id }} 内所有超标读数
          </div>
          <div class="alarm-list">
            <div v-for="a in event.alarms" :key="a.id" class="a-item">
              <div>
                <StatusBadge :map="SEVERITY" :value="a.level" />
                <span class="strong" style="margin-left:6px">{{ formatNumber(a.value) }}</span>
                <span class="muted" style="font-size:12px">/ {{ a.limit_value }}</span>
              </div>
              <div class="muted" style="font-size:11px">{{ formatTime(a.created_at) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 状态流转弹窗 -->
    <div v-if="actionModal" class="modal-mask" @click.self="actionModal = null">
      <div class="modal">
        <h3>{{ ACTION_LABEL[actionModal.action] }}</h3>
        <div class="form-row">
          <label>操作人</label>
          <input v-model="form.actor" placeholder="姓名" />
        </div>
        <div class="form-row" v-if="actionModal.needResolution">
          <label>处置措施说明（必填）</label>
          <textarea v-model="form.resolution" rows="4"
            placeholder="如：更换破损滤袋、调整脱硝氨水喷量、修复密封点等"></textarea>
        </div>
        <div class="form-row" v-else>
          <label>备注（选填）</label>
          <textarea v-model="form.note" rows="2"></textarea>
        </div>
        <div class="modal-actions">
          <button class="btn" @click="actionModal = null">取消</button>
          <button class="btn btn-primary" @click="submitAction">确认提交</button>
        </div>
      </div>
    </div>

    <!-- 指派弹窗 -->
    <div v-if="assignModal" class="modal-mask" @click.self="assignModal = false">
      <div class="modal">
        <h3>{{ event?.handler ? '改派负责人' : '指派负责人' }}</h3>
        <div class="form-row">
          <label>负责人姓名</label>
          <input v-model="form.handler" :placeholder="event?.handler || '请输入'" />
        </div>
        <div class="form-row">
          <label>操作人</label>
          <input v-model="form.actor" />
        </div>
        <div class="form-row">
          <label>备注</label>
          <input v-model="form.note" />
        </div>
        <div class="modal-actions">
          <button class="btn" @click="assignModal = false">取消</button>
          <button class="btn btn-primary" @click="submitAssign">确认指派</button>
        </div>
      </div>
    </div>

    <!-- 备注弹窗 -->
    <div v-if="commentModal" class="modal-mask" @click.self="commentModal = false">
      <div class="modal">
        <h3>添加处置备注</h3>
        <div class="form-row">
          <label>操作人</label>
          <input v-model="form.actor" />
        </div>
        <div class="form-row">
          <label>备注内容</label>
          <textarea v-model="form.note" rows="3"></textarea>
        </div>
        <div class="modal-actions">
          <button class="btn" @click="commentModal = false">取消</button>
          <button class="btn btn-primary" @click="submitComment">提交</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ml { margin-left: 8px; }
.head { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.title { font-size: 18px; font-weight: 700; display: flex; align-items: center; }
.sub { color: var(--text-muted); font-size: 13px; margin-top: 6px; display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
.head-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.meta-grid {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 10px; margin: 16px 0 0; padding-top: 14px;
  border-top: 1px solid var(--border);
}
.meta-grid dt { font-size: 12px; color: var(--text-muted); }
.meta-grid dd { margin: 3px 0 0; font-weight: 600; }
.resolution {
  margin-top: 12px; padding: 10px 12px;
  background: #f0fdf4; border: 1px solid #bbf7d0;
  border-radius: 8px; font-size: 13px;
}
.eq-link {
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid var(--border);
  display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
}
.timeline { padding-left: 4px; }
.t-item { display: flex; gap: 12px; padding-bottom: 18px; position: relative; }
.t-item:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 5px; top: 16px; bottom: 0;
  width: 2px; background: var(--border);
}
.t-dot {
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--primary); margin-top: 4px;
  flex-shrink: 0; z-index: 1;
}
.t-dot.last { background: var(--ok); }
.t-head { display: flex; gap: 10px; align-items: center; }
.t-note { margin: 4px 0; font-size: 13px; }
.alarm-list { max-height: 480px; overflow-y: auto; }
.a-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 2px; border-bottom: 1px solid var(--border);
}
</style>
