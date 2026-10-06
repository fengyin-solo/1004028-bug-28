<template>
  <section class="page" v-if="view">
    <header class="page-head">
      <div>
        <h2>井盖设施详情 · {{ code }}</h2>
        <p class="page-desc">状态由养护规则统一判定；确认更换时按新井盖类型、材质、安装日期重算，旧件按当时标准冻结周期记录。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" :to="{ name: 'manhole' }">返回列表</RouterLink>
      </div>
    </header>

    <div class="detail-layout">
      <div class="detail-main">
        <article class="panel">
          <h3 class="panel-title">基础信息</h3>
          <dl class="info-grid">
            <div v-for="item in infoItems" :key="item.label" class="info-item">
              <dt>{{ item.label }}</dt>
              <dd :class="{ missing: item.missing }">{{ item.value }}</dd>
            </div>
          </dl>
        </article>

        <article class="panel">
          <h3 class="panel-title">当前判定</h3>
          <p class="judge-status">
            当前状态：
            <span class="status-pill" :data-status="view.status">{{ view.status }}</span>
            <span class="judge-date">（基准日 {{ TODAY }}）</span>
          </p>
          <ul class="reason-list">
            <li v-for="(reason, index) in view.reasons" :key="index">{{ reason }}</li>
          </ul>
        </article>

        <article class="panel" v-if="view.phase === 'maintaining'">
          <h3 class="panel-title">确认更换（按新井盖信息重算规则）</h3>
          <p class="page-desc" style="margin: 0 0 8px">
            录入新井盖的类型、材质、规格与安装日期后确认；当前现行规则为《{{ currentVersion.label }}》。
          </p>
          <form class="replace-form" @submit.prevent="submitReplacement">
            <label class="form-item">
              <span>井盖类型</span>
              <select v-model="form.coverType">
                <option value="">请选择类型</option>
                <option v-for="type in coverTypes" :key="type" :value="type">{{ type }}</option>
              </select>
            </label>
            <label class="form-item">
              <span>井盖材质</span>
              <select v-model="form.material">
                <option value="">请选择材质</option>
                <option v-for="material in materials" :key="material" :value="material">{{ material }}</option>
              </select>
            </label>
            <label class="form-item">
              <span>规格尺寸</span>
              <input v-model="form.spec" placeholder="如 Φ700" />
            </label>
            <label class="form-item">
              <span>安装日期</span>
              <input v-model="form.installDate" type="date" :max="TODAY" />
            </label>
            <div class="form-actions">
              <button class="btn primary" type="submit">确认更换并重算</button>
            </div>
          </form>
          <p class="form-hint">
            提示：缺少安装日期或规格尺寸时，新井盖会进入「待补充」而不是直接正常；类型与材质在规则表中无对应周期时进入「异常」并注明条件。
          </p>
        </article>

        <article class="panel">
          <h3 class="panel-title">本井盖养护周期记录</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th>安装日期</th>
                <th>更换日期</th>
                <th>使用天数</th>
                <th>当时周期</th>
                <th>应办日期</th>
                <th>结论</th>
                <th>判定说明</th>
                <th>适用规则版本</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="record in ownHistory" :key="record.recordId">
                <td>{{ record.startDate || '—' }}</td>
                <td>{{ record.replacedAt }}</td>
                <td>{{ record.daysUsed }}</td>
                <td>{{ record.cycleText }}</td>
                <td>{{ record.dueText }}</td>
                <td><span class="status-pill" :data-status="record.conclusion">{{ record.conclusion }}</span></td>
                <td class="reason-cell" :title="record.reasons.join('；')">{{ record.reasons.join('；') }}</td>
                <td>{{ record.ruleLabel }}</td>
              </tr>
              <tr v-if="!ownHistory.length">
                <td colspan="8" class="empty-state">暂无更换记录；确认更换后会在此冻结一条周期记录</td>
              </tr>
            </tbody>
          </table>
        </article>
      </div>

      <aside class="detail-side">
        <article class="panel">
          <h3 class="panel-title">可执行动作</h3>
          <div class="action-stack">
            <button
              class="btn"
              type="button"
              :disabled="!canApply"
              @click="doAction('申请维护')"
            >
              申请维护
            </button>
            <button
              class="btn"
              type="button"
              :disabled="!canStart"
              @click="doAction('开始维护')"
            >
              开始维护
            </button>
            <p class="action-hint">{{ actionHint }}</p>
          </div>
        </article>

        <article class="panel">
          <h3 class="panel-title">现行养护规则</h3>
          <p class="page-desc" style="margin: 0 0 8px">{{ currentVersion.label }}（{{ currentVersion.effectiveFrom }} 起生效）</p>
          <table class="data-table rule-table">
            <thead>
              <tr><th>类型</th><th>材质</th><th>周期(月)</th></tr>
            </thead>
            <tbody>
              <tr v-for="rule in currentVersion.rules" :key="`${rule.coverType}-${rule.material}`">
                <td>{{ rule.coverType }}</td>
                <td>{{ rule.material }}</td>
                <td>{{ rule.cycleMonths }}</td>
              </tr>
            </tbody>
          </table>
          <p class="form-hint">规则调整只影响调整之后的判定；本井盖历史周期记录仍按更换当时的版本保留。</p>
        </article>
      </aside>
    </div>

    <footer class="page-foot">
      <span v-if="feedback" :class="feedback.ok ? 'ok-text' : 'error-text'">{{ feedback.message }}</span>
    </footer>
  </section>

  <section class="page" v-else>
    <p class="empty-state">没有找到该井盖设施，<RouterLink class="link" :to="{ name: 'manhole' }">返回列表</RouterLink></p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onBeforeRouteUpdate, useRoute } from 'vue-router'

import { runAction as applyAction } from '@/api/local-service'
import { listRows } from '@/data/local-store'
import { currentRuleVersion } from '@/domain/manhole/rules'
import {
  confirmReplacement,
  deriveManhole,
  listManholeHistory,
  type ManholeViewRow,
} from '@/domain/manhole/service'

const route = useRoute()
const TODAY = '2026-10-06'
const currentVersion = currentRuleVersion(TODAY)
const coverTypes = [...new Set(currentVersion.rules.map((rule) => rule.coverType))]
const materials = [...new Set(currentVersion.rules.map((rule) => rule.material))]

const feedback = ref<{ ok: boolean; message: string }>({ ok: true, message: '' })

const form = ref({ coverType: '', material: '', spec: '', installDate: '' })
const view = ref<ManholeViewRow | null>(null)
const ownHistory = ref(listManholeHistory())

function load() {
  const id = Number(route.params.id)
  const row = listRows('manhole').find((item) => Number(item.id) === id) ?? null
  view.value = row ? deriveManhole(row) : null
  ownHistory.value = listManholeHistory({ manholeCode: row ? String(row['井盖编号'] ?? '') : '' })
  feedback.value = { ok: true, message: '' }
  if (row) {
    form.value = {
      coverType: String(row['井盖类型'] ?? ''),
      material: String(row['井盖材质'] ?? ''),
      spec: String(row['规格尺寸'] ?? ''),
      installDate: TODAY,
    }
  }
}

onBeforeRouteUpdate(() => load())
load()

const code = computed(() => String(view.value?.raw['井盖编号'] ?? ''))

const infoItems = computed(() => {
  if (!view.value) {
    return []
  }
  const raw = view.value.raw
  const items = [
    { label: '井盖编号', value: String(raw['井盖编号'] ?? '—') },
    { label: '所属道路', value: String(raw['所属道路'] ?? '—') },
    { label: '井盖类型', value: String(raw['井盖类型'] ?? '') || '未填写' },
    { label: '井盖材质', value: String(raw['井盖材质'] ?? '') || '未填写' },
    { label: '规格尺寸', value: String(raw['规格尺寸'] ?? '') || '未填写' },
    { label: '安装日期', value: String(raw['安装日期'] ?? '') || '未填写' },
    { label: '养护周期', value: view.value.cycleText },
    { label: '应办日期', value: view.value.dueText },
  ]
  return items.map((item) => ({ ...item, missing: item.value === '未填写' }))
})

const canApply = computed(
  () =>
    view.value !== null &&
    view.value.phase === 'in_service' &&
    view.value.raw.requested !== true &&
    view.value.status !== '待补充' &&
    view.value.status !== '异常',
)
const canStart = computed(
  () =>
    view.value !== null &&
    view.value.phase === 'in_service' &&
    (view.value.status === '待维护' || view.value.raw.requested === true),
)
const actionHint = computed(() => {
  if (!view.value) {
    return ''
  }
  if (view.value.phase === 'maintaining') {
    return '井盖维护中，请在下方表单录入新井盖信息后确认更换'
  }
  if (view.value.status === '待补充') {
    return '档案缺少安装日期或规格尺寸，补齐后才能申请维护'
  }
  if (view.value.status === '异常') {
    return `类型/材质无适用规则：${view.value.reasons.join('；')}`
  }
  if (String(view.value.raw['最近更换日期'] ?? '')) {
    return `最近一次更换：${String(view.value.raw['最近更换日期'])}；新井盖已按当时信息重算周期，历史记录见下方`
  }
  return '动作执行后状态由规则统一重算，列表与本页保持一致'
})

function doAction(action: '申请维护' | '开始维护') {
  if (!view.value) {
    return
  }
  const result = applyAction('manhole', view.value.id, action)
  feedback.value = { ok: result.ok, message: result.message }
  if (result.ok) {
    load()
  }
}

function submitReplacement() {
  if (!view.value) {
    return
  }
  const result = confirmReplacement(listRows('manhole'), view.value.id, { ...form.value })
  feedback.value = { ok: result.ok, message: result.message }
  if (result.ok) {
    // 留在详情页展示重算结果，便于和列表状态逐项核对。
    load()
  }
}
</script>

<style scoped>
.detail-layout { display: flex; gap: 12px; align-items: flex-start; }
.detail-main { flex: 1; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.detail-side { width: 320px; display: flex; flex-direction: column; gap: 12px; }
.panel { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.panel-title { margin: 0 0 10px; font-size: 14px; }
.info-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 16px; margin: 0; }
.info-item dt { font-size: 12px; color: var(--muted); }
.info-item dd { margin: 2px 0 0; font-size: 13px; }
.info-item dd.missing { color: #b42318; }
.judge-status { margin: 0 0 8px; font-size: 13px; }
.judge-date { color: var(--muted); }
.reason-list { margin: 0; padding-left: 18px; font-size: 13px; color: #334155; }
.reason-list li { margin-bottom: 4px; }
.replace-form { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 12px; }
.form-item span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.form-item input, .form-item select { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.form-actions { grid-column: 1 / -1; }
.form-hint { margin: 8px 0 0; font-size: 12px; color: var(--muted); }
.action-stack { display: flex; flex-direction: column; gap: 8px; }
.action-stack .btn { width: 100%; }
.action-hint { font-size: 12px; color: var(--muted); margin: 4px 0 0; }
.rule-table { font-size: 12px; }
.reason-cell { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
.status-pill { border-radius: 999px; padding: 2px 10px; font-size: 12px; background: #eef2f7; }
.status-pill[data-status='正常'] { background: #dcfce7; color: #166534; }
.status-pill[data-status='待维护'] { background: #fef3c7; color: #92400e; }
.status-pill[data-status='维护中'] { background: #dbeafe; color: #1e40af; }
.status-pill[data-status='待补充'] { background: #f3e8ff; color: #6b21a8; }
.status-pill[data-status='异常'] { background: #fee2e2; color: #991b1b; }
.status-pill[data-status='已更换'] { background: #e0f2fe; color: #075985; }
.ok-text { color: #166534; }
</style>
