<template>
  <section class="page" v-if="detail">
    <header class="page-head">
      <div>
        <h2>井盖详情 · {{ detail.cover.coverNo }}</h2>
        <p class="page-desc">
          <RouterLink class="link" to="/manhole">返回井盖台账</RouterLink>
          ｜ 所属道路：{{ detail.cover.road }}
          <span v-if="detail.cover.replaceCount > 0" class="replaced-tag">已更换 {{ detail.cover.replaceCount }} 次</span>
        </p>
      </div>
    </header>

    <p v-if="message" class="form-message" :class="messageKind">{{ message }}</p>

    <div class="detail-grid">
      <article class="detail-card">
        <h3>井盖档案</h3>
        <dl class="info-list">
          <div><dt>井盖类型</dt><dd>{{ detail.cover.coverType }}</dd></div>
          <div><dt>井盖材质</dt><dd>{{ detail.cover.material }}</dd></div>
          <div>
            <dt>规格尺寸</dt>
            <dd :class="{ missing: !detail.cover.spec }">{{ detail.cover.spec || '缺失，待补充' }}</dd>
          </div>
          <div>
            <dt>安装日期</dt>
            <dd :class="{ missing: !detail.cover.installDate }">{{ detail.cover.installDate || '缺失，待补充' }}</dd>
          </div>
          <div><dt>工作阶段</dt><dd>{{ phaseText }}</dd></div>
        </dl>
      </article>

      <article class="detail-card">
        <h3>当前状态判定</h3>
        <p class="status-line">
          <span class="status-pill" :data-status="detail.evaluation.status">{{ detail.evaluation.status }}</span>
          <span class="reason-text">{{ detail.evaluation.message }}</span>
        </p>
        <dl class="info-list">
          <div><dt>养护周期</dt><dd>{{ detail.evaluation.cycleDays !== null ? `${detail.evaluation.cycleDays} 天` : '—' }}</dd></div>
          <div><dt>预警窗口</dt><dd>{{ detail.evaluation.warnDays !== null ? `到期前 ${detail.evaluation.warnDays} 天` : '—' }}</dd></div>
          <div><dt>周期起算日</dt><dd>{{ detail.evaluation.startDate ?? '—' }}</dd></div>
          <div><dt>本次到期日</dt><dd>{{ detail.evaluation.dueDate ?? '—' }}</dd></div>
          <div><dt>距到期</dt><dd>{{ daysText(detail.evaluation) }}</dd></div>
          <div><dt>适用规则版本</dt><dd>{{ detail.evaluation.ruleVersion !== null ? `V${detail.evaluation.ruleVersion}` : '—' }}</dd></div>
        </dl>
        <p class="rule-hint">{{ detail.evaluation.ruleText || '无适用养护标准' }}</p>
        <div class="action-list">
          <button
            class="btn"
            type="button"
            :disabled="detail.cover.phase !== '正常'"
            @click="onRequest"
          >申请维护</button>
          <button
            class="btn"
            type="button"
            :disabled="detail.cover.phase !== '已申请'"
            @click="onStart"
          >开始维护</button>
          <button
            class="btn primary"
            type="button"
            :disabled="detail.cover.phase !== '维护中'"
            @click="openReplace"
          >确认更换</button>
          <button
            class="btn"
            type="button"
            :disabled="detail.evaluation.status !== '待补充'"
            @click="openSupplement"
          >补充资料</button>
        </div>
        <p class="action-hint">
          状态由「类型/材质 + 安装日期」对应规则统一判定，与台账列表完全一致；重复确认更换不会生成多余的周期记录。
        </p>
      </article>
    </div>

    <!-- 确认更换：按新井盖类型、材质、安装日期重算规则 -->
    <article v-if="showReplace" class="detail-card form-card">
      <h3>确认更换</h3>
      <p class="page-desc">
        更换后旧养护周期立即关闭，系统按新井盖类型、材质与新安装日期对应的规则版本重新计算周期与状态。
      </p>
      <div class="form-grid">
        <label><span>新井盖类型</span>
          <select v-model="replaceForm.coverType">
            <option v-for="t in coverTypes" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>
        <label><span>新井盖材质</span>
          <select v-model="replaceForm.material">
            <option v-for="m in materials" :key="m" :value="m">{{ m }}</option>
          </select>
        </label>
        <label><span>规格尺寸</span><input v-model="replaceForm.spec" placeholder="如 Φ700" /></label>
        <label><span>新安装日期</span><input v-model="replaceForm.installDate" type="date" :max="today" /></label>
      </div>
      <p class="form-preview">{{ replacePreview }}</p>
      <div class="editor-actions">
        <button class="btn ghost" type="button" @click="showReplace = false">取消</button>
        <button class="btn primary" type="button" @click="submitReplace">提交更换（仅一次）</button>
      </div>
    </article>

    <!-- 补充资料 -->
    <article v-if="showSupplement" class="detail-card form-card">
      <h3>补充资料</h3>
      <p class="page-desc">补齐安装日期与规格尺寸后建立养护周期；已存在周期时不会重复创建。</p>
      <div class="form-grid">
        <label><span>安装日期</span>
          <input v-model="supplementForm.installDate" type="date" :max="today" />
        </label>
        <label><span>规格尺寸</span><input v-model="supplementForm.spec" placeholder="如 600×600" /></label>
      </div>
      <div class="editor-actions">
        <button class="btn ghost" type="button" @click="showSupplement = false">取消</button>
        <button class="btn primary" type="button" @click="submitSupplement">保存并计算周期</button>
      </div>
    </article>

    <article class="detail-card">
      <h3>养护周期记录</h3>
      <table class="data-table compact">
        <thead>
          <tr>
            <th>周期</th><th>井盖信息</th><th>安装/起算日</th><th>到期日</th>
            <th>周期(天)</th><th>适用版本</th><th>关闭日期</th><th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(cycle, idx) in detail.cycles" :key="cycle.id">
            <td>第 {{ detail.cycles.length - idx }} 个周期</td>
            <td>{{ cycle.coverType }} / {{ cycle.material }}（{{ cycle.spec || '规格缺失' }}）</td>
            <td>{{ cycle.startDate }}</td>
            <td>{{ cycle.dueDate }}</td>
            <td>{{ cycle.rule?.cycleDays ?? '—' }}</td>
            <td>V{{ cycle.ruleVersion }}</td>
            <td>{{ cycle.endDate ?? '进行中' }}</td>
            <td>
              <span v-if="cycle.endDate" class="muted">更换关闭</span>
              <span v-else class="status-pill" :data-status="detail.evaluation.status" :class="{ tiny: true }">
                {{ detail.evaluation.status }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </article>

    <article class="detail-card">
      <h3>维护履历</h3>
      <table class="data-table compact">
        <thead>
          <tr><th>日期</th><th>事项</th><th>说明</th><th>当时适用规则</th><th>规则版本</th></tr>
        </thead>
        <tbody>
          <tr v-for="event in detail.events" :key="event.id">
            <td>{{ event.date }}</td>
            <td>{{ event.type }}</td>
            <td>{{ event.detail }}</td>
            <td>{{ event.ruleText }}</td>
            <td>{{ event.ruleVersion !== null ? `V${event.ruleVersion}` : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </article>
  </section>

  <section v-else class="page">
    <p class="error-text">没有找到该井盖设施。</p>
    <RouterLink class="link" to="/manhole">返回井盖台账</RouterLink>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import {
  confirmReplacement,
  daysText,
  getCover,
  requestMaintenance,
  startMaintenance,
  supplementInfo,
} from '@/api/manhole-service'
import type { CoverDetail, ReplaceInput } from '@/api/manhole-service'
import {
  COVER_TYPES,
  MATERIALS,
  addDaysISO,
  describeRule,
  diffDays,
  effectiveVersion,
  findRule,
  isValidISODate,
  todayISO,
} from '@/data/manhole/rules'
import { manholeDataset } from '@/data/manhole/store'

const route = useRoute()
const coverId = Number(route.params.id)
const today = todayISO()
const coverTypes = COVER_TYPES
const materials = MATERIALS

const detail = ref<CoverDetail | null>(getCover(coverId))
const message = ref('')
const messageKind = ref<'ok' | 'err'>('ok')
const showReplace = ref(false)
const showSupplement = ref(false)
const replaceForm = ref<ReplaceInput>({ coverType: '', material: '', spec: '', installDate: today })
const supplementForm = ref({ installDate: '', spec: '' })

const phaseText = computed(() => {
  const phase = detail.value?.cover.phase
  if (phase === '维护中') return '维护中'
  if (phase === '已申请') return '已申请维护'
  return '日常使用'
})

const replacePreview = computed(() => {
  const form = replaceForm.value
  if (!isValidISODate(form.installDate) || !form.coverType || !form.material) {
    return '请先选择新井盖类型、材质并填写安装日期。'
  }
  const version = effectiveVersion(manholeDataset().ruleVersions, form.installDate)
  const rule = findRule(version.rules, form.coverType, form.material)
  if (!rule) {
    return `规则版本 V${version.version} 中没有「${form.coverType}/${form.material}」的养护标准，需先在「养护规则」页发布新版本。`
  }
  const dueDate = addDaysISO(form.installDate, rule.cycleDays)
  return `将按 V${version.version} 执行：${describeRule(rule)}；新周期 ${form.installDate} 起算，到期日 ${dueDate}（${daysToDueText(form.installDate, dueDate)}）。`
})

function daysToDueText(start: string, due: string): string {
  const d = diffDays(start, due)
  return `周期长度 ${d} 天`
}

function refresh(): void {
  detail.value = getCover(coverId)
}

function notify(text: string, ok: boolean): void {
  message.value = text
  messageKind.value = ok ? 'ok' : 'err'
}

function onRequest(): void {
  const result = requestMaintenance(coverId)
  notify(result.message, result.ok)
  refresh()
}

function onStart(): void {
  const result = startMaintenance(coverId)
  notify(result.message, result.ok)
  refresh()
}

function openReplace(): void {
  const cover = detail.value?.cover
  if (!cover) return
  replaceForm.value = {
    coverType: cover.coverType,
    material: cover.material,
    spec: cover.spec,
    installDate: today,
  }
  message.value = ''
  showReplace.value = true
}

function submitReplace(): void {
  const result = confirmReplacement(coverId, { ...replaceForm.value })
  notify(result.message, result.ok)
  if (result.ok) {
    showReplace.value = false
    refresh()
  }
}

function openSupplement(): void {
  supplementForm.value = {
    installDate: detail.value?.cover.installDate ?? '',
    spec: detail.value?.cover.spec ?? '',
  }
  message.value = ''
  showSupplement.value = true
}

function submitSupplement(): void {
  const result = supplementInfo(coverId, { ...supplementForm.value })
  notify(result.message, result.ok)
  if (result.ok) {
    showSupplement.value = false
    refresh()
  }
}

onMounted(refresh)
</script>

<style scoped>
.detail-grid { display: grid; grid-template-columns: 1fr 1.4fr; gap: 12px; margin-bottom: 12px; }
.detail-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin-bottom: 12px; }
.detail-card h3 { margin: 0 0 10px; font-size: 15px; }
.info-list { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; margin: 0; }
.info-list div { display: flex; justify-content: space-between; border-bottom: 1px dashed var(--border); padding: 4px 0; font-size: 13px; }
.info-list dt { color: var(--muted); }
.info-list dd { margin: 0; }
.info-list .missing, dd.missing { color: #6d28d9; }
.status-line { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.status-pill { border-radius: 999px; padding: 3px 12px; font-size: 13px; white-space: nowrap; }
.status-pill.tiny { padding: 1px 8px; font-size: 11px; }
.status-pill[data-status='正常'] { background: #e7f6ec; color: #1a7f37; }
.status-pill[data-status='待维护'] { background: #fff4e0; color: #b25e09; }
.status-pill[data-status='维护中'] { background: #e8f0fe; color: #1f6feb; }
.status-pill[data-status='已到期'] { background: #fde8e8; color: #b42318; }
.status-pill[data-status='待补充'] { background: #f1ecfe; color: #6d28d9; }
.status-pill[data-status='异常'] { background: #fde8e8; color: #b42318; font-weight: 600; }
.reason-text { font-size: 13px; color: #1f2937; }
.rule-hint { font-size: 12px; color: var(--muted); background: #f6f8fb; border-radius: 6px; padding: 6px 8px; margin: 8px 0; }
.action-list { display: flex; gap: 8px; flex-wrap: wrap; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.action-hint { font-size: 12px; color: var(--muted); margin: 10px 0 0; }
.form-card { border-color: var(--brand); }
.form-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 8px 0; }
.form-grid label span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.form-grid input, .form-grid select { width: 100%; border: 1px solid var(--border); border-radius: 4px; padding: 6px; font-size: 13px; }
.form-preview { font-size: 12px; color: var(--brand); background: #f2f7ff; border-radius: 6px; padding: 6px 8px; }
.editor-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.data-table.compact th, .data-table.compact td { padding: 6px 8px; font-size: 12px; }
.replaced-tag { margin-left: 8px; background: #e8f0fe; color: #1f6feb; border-radius: 4px; padding: 0 6px; font-size: 11px; }
.form-message.ok { color: #1a7f37; font-size: 13px; }
.form-message.err { color: #b42318; font-size: 13px; }
.muted { color: var(--muted); }
</style>
