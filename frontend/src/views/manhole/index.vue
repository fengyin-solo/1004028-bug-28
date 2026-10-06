<template>
  <section class="page" data-module="manhole">
    <header class="page-head">
      <div>
        <h2>井盖设施管理</h2>
        <p class="page-desc">
          围绕井盖编号、所属道路、井盖类型、井盖材质做登记筛选；养护状态按「类型/材质 + 安装日期」对应规则统一判定，列表与详情口径一致。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出井盖设施清单</button>
        <button class="btn ghost" type="button" @click="resetAll">恢复示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <nav class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </nav>

    <p v-if="message" class="form-message" :class="messageKind">{{ message }}</p>

    <!-- 台账 -->
    <div v-if="activeTab === 'covers'">
      <p class="status-legend">
        <span v-for="item in overview.byStatus" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <form class="filter-bar" @submit.prevent="reload">
        <label class="filter-item">
          <span>关键字</span>
          <input v-model="keyword" placeholder="按编号 / 道路 / 类型 / 材质检索" />
        </label>
        <label class="filter-item">
          <span>当前状态</span>
          <select v-model="statusFilter">
            <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th>井盖编号</th>
            <th>所属道路</th>
            <th>井盖类型</th>
            <th>井盖材质</th>
            <th>规格尺寸</th>
            <th>安装日期</th>
            <th>养护周期</th>
            <th>到期日</th>
            <th>当前状态</th>
            <th>判定说明</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.cover.id">
            <td>
              <RouterLink class="link" :to="`/manhole/${row.cover.id}`">{{ row.cover.coverNo }}</RouterLink>
              <span v-if="row.cover.replaceCount > 0" class="replaced-tag">已换×{{ row.cover.replaceCount }}</span>
            </td>
            <td>{{ row.cover.road }}</td>
            <td>{{ row.cover.coverType }}</td>
            <td>{{ row.cover.material }}</td>
            <td :class="{ 'cell-missing': !row.cover.spec }">{{ row.cover.spec || '缺失' }}</td>
            <td :class="{ 'cell-missing': !row.cover.installDate }">{{ row.cover.installDate || '缺失' }}</td>
            <td>{{ row.evaluation.cycleDays !== null ? `${row.evaluation.cycleDays} 天` : '—' }}</td>
            <td>{{ row.evaluation.dueDate ?? '—' }}</td>
            <td><span class="status-pill" :data-status="row.evaluation.status">{{ row.evaluation.status }}</span></td>
            <td class="reason-cell">{{ row.evaluation.message }}</td>
            <td><RouterLink class="link" :to="`/manhole/${row.cover.id}`">查看详情</RouterLink></td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="11" class="empty-state">暂无符合条件的井盖设施</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>共 {{ total }} 条井盖设施记录</span>
      </footer>
    </div>

    <!-- 历史维护工作台 -->
    <div v-else-if="activeTab === 'workbench'">
      <p class="page-desc" style="margin: 0 0 10px">
        维护履历只追加、不改写；每条记录保留当时适用的规则版本，规则调整后历史工作台仍按当时标准展示。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>井盖编号</th>
            <th>事项</th>
            <th>说明</th>
            <th>当时适用规则</th>
            <th>规则版本</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in events" :key="event.id">
            <td>{{ event.date }}</td>
            <td><RouterLink class="link" :to="`/manhole/${event.coverId}`">{{ event.coverNo }}</RouterLink></td>
            <td>{{ event.type }}</td>
            <td>{{ event.detail }}</td>
            <td>{{ event.ruleText }}</td>
            <td>{{ event.ruleVersion !== null ? `V${event.ruleVersion}` : '—' }}</td>
          </tr>
          <tr v-if="!events.length">
            <td colspan="6" class="empty-state">暂无维护履历</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 规则版本管理 -->
    <div v-else>
      <p class="page-desc" style="margin: 0 0 10px">
        调整养护规则只会发布新版本（生效日期不早于今天），新版本只影响之后开始计算的养护周期；历史版本不可修改。
      </p>
      <div class="rule-version-list">
        <article v-for="version in versions" :key="version.version" class="rule-card">
          <header class="rule-card-head">
            <div>
              <strong>规则版本 V{{ version.version }}</strong>
              <span class="rule-meta">生效日期：{{ version.effectiveDate }}</span>
            </div>
            <span v-if="version.version === versions[0]?.version" class="replaced-tag">最新版本</span>
          </header>
          <p class="rule-note">{{ version.note }}</p>
          <table class="data-table compact">
            <thead>
              <tr><th>井盖类型</th><th>井盖材质</th><th>养护周期(天)</th><th>到期预警(天)</th></tr>
            </thead>
            <tbody>
              <tr v-for="(rule, idx) in version.rules" :key="`${version.version}-${idx}`">
                <td>{{ rule.coverType }}</td>
                <td>{{ rule.material }}</td>
                <td>{{ rule.cycleDays }}</td>
                <td>{{ rule.warnDays }}</td>
              </tr>
            </tbody>
          </table>
        </article>
      </div>

      <div class="rule-editor">
        <h3>发布新版本</h3>
        <p class="page-desc">默认复制最新版本的规则，可在此基础上调整周期与预警天数。</p>
        <div class="filter-bar">
          <label class="filter-item">
            <span>生效日期</span>
            <input v-model="draft.effectiveDate" type="date" :min="today" />
          </label>
          <label class="filter-item filter-grow">
            <span>调整说明</span>
            <input v-model="draft.note" placeholder="例如：复合材料井盖周期统一延长至 150 天" />
          </label>
        </div>
        <table class="data-table compact">
          <thead>
            <tr><th>井盖类型</th><th>井盖材质</th><th>养护周期(天)</th><th>到期预警(天)</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="(rule, idx) in draft.rules" :key="idx">
              <td>
                <select v-model="rule.coverType">
                  <option v-for="t in coverTypes" :key="t" :value="t">{{ t }}</option>
                </select>
              </td>
              <td>
                <select v-model="rule.material">
                  <option v-for="m in materials" :key="m" :value="m">{{ m }}</option>
                </select>
              </td>
              <td><input v-model.number="rule.cycleDays" type="number" min="1" class="num-input" /></td>
              <td><input v-model.number="rule.warnDays" type="number" min="0" class="num-input" /></td>
              <td><button class="link danger" type="button" @click="draft.rules.splice(idx, 1)">删除</button></td>
            </tr>
          </tbody>
        </table>
        <div class="editor-actions">
          <button class="btn" type="button" @click="addDraftRule">新增规则行</button>
          <button class="btn primary" type="button" @click="publishVersion">发布新版本</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadManholeCSV,
  listCovers,
  listRuleVersions,
  listWorkEvents,
  manholeOverview,
  resetManhole,
  saveRuleVersion,
} from '@/api/manhole-service'
import { COVER_TYPES, MATERIALS, latestVersion, todayISO } from '@/data/manhole/rules'
import type {
  CoverRow,
  ManholeRule,
  ManholeRuleVersion,
  WorkEvent,
} from '@/api/manhole-service'

const tabs = [
  { key: 'covers', label: '养护台账' },
  { key: 'workbench', label: '历史维护工作台' },
  { key: 'rules', label: '养护规则' },
] as const

const statusOptions = ['全部', '正常', '待维护', '维护中', '已到期', '待补充', '异常']

const activeTab = ref<(typeof tabs)[number]['key']>('covers')
const rows = ref<CoverRow[]>([])
const total = ref(0)
const events = ref<WorkEvent[]>([])
const versions = ref<ManholeRuleVersion[]>([])
const keyword = ref('')
const statusFilter = ref('全部')
const message = ref('')
const messageKind = ref<'ok' | 'err'>('ok')
const today = todayISO()

const coverTypes = COVER_TYPES
const materials = MATERIALS

const overview = ref(manholeOverview())
const statCards = computed(() => [
  { label: '井盖总数', value: overview.value.total },
  { label: '待维护/已到期', value: overview.value.pending },
  { label: '维护中', value: overview.value.inProgress },
  { label: '待补充资料', value: overview.value.needInfo },
  { label: '异常', value: overview.value.abnormal },
  { label: '更换过的井盖', value: overview.value.replaced },
])

function notify(text: string, ok = true): void {
  message.value = text
  messageKind.value = ok ? 'ok' : 'err'
}

function reload(): void {
  const payload = listCovers({ keyword: keyword.value, status: statusFilter.value })
  rows.value = payload.items
  total.value = payload.total
  overview.value = manholeOverview()
  events.value = listWorkEvents()
  versions.value = listRuleVersions()
}

function resetFilters(): void {
  keyword.value = ''
  statusFilter.value = '全部'
  reload()
}

function exportRows(): void {
  downloadManholeCSV()
}

function resetAll(): void {
  resetManhole()
  resetDraft()
  reload()
  notify('已恢复为示例数据')
}

const draft = ref<{ effectiveDate: string; note: string; rules: ManholeRule[] }>({
  effectiveDate: today,
  note: '',
  rules: [],
})

function resetDraft(): void {
  const latest = latestVersion(versions.value.length ? versions.value : [])
  draft.value = {
    effectiveDate: today,
    note: '',
    rules: latest.rules.map((rule) => ({ ...rule })),
  }
}

function addDraftRule(): void {
  const used = new Set(draft.value.rules.map((r) => `${r.coverType}|${r.material}`))
  const next = COVER_TYPES.flatMap((coverType) =>
    MATERIALS.map((material) => ({ coverType, material })),
  ).find((pair) => !used.has(`${pair.coverType}|${pair.material}`))
  draft.value.rules.push(
    next
      ? { ...next, cycleDays: 180, warnDays: 30 }
      : { coverType: COVER_TYPES[0], material: MATERIALS[0], cycleDays: 180, warnDays: 30 },
  )
}

function publishVersion(): void {
  const result = saveRuleVersion(draft.value)
  notify(result.message, result.ok)
  if (result.ok) {
    reload()
    resetDraft()
  }
}

onMounted(() => {
  reload()
  resetDraft()
})
</script>

<style scoped>
.tab-bar { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
.tab-btn { border: none; background: none; padding: 8px 16px; cursor: pointer; font-size: 14px; color: var(--muted); border-bottom: 2px solid transparent; }
.tab-btn.active { color: var(--brand); border-bottom-color: var(--brand); font-weight: 600; }
.status-pill { border-radius: 999px; padding: 2px 10px; font-size: 12px; white-space: nowrap; }
.status-pill[data-status='正常'] { background: #e7f6ec; color: #1a7f37; }
.status-pill[data-status='待维护'] { background: #fff4e0; color: #b25e09; }
.status-pill[data-status='维护中'] { background: #e8f0fe; color: #1f6feb; }
.status-pill[data-status='已到期'] { background: #fde8e8; color: #b42318; }
.status-pill[data-status='待补充'] { background: #f1ecfe; color: #6d28d9; }
.status-pill[data-status='异常'] { background: #fde8e8; color: #b42318; font-weight: 600; }
.reason-cell { color: var(--muted); max-width: 320px; }
.cell-missing { color: #6d28d9; }
.replaced-tag { margin-left: 6px; background: #e8f0fe; color: #1f6feb; border-radius: 4px; padding: 0 6px; font-size: 11px; }
.form-message.ok { color: #1a7f37; font-size: 13px; }
.form-message.err { color: #b42318; font-size: 13px; }
.rule-version-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; }
.rule-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.rule-card-head { display: flex; justify-content: space-between; align-items: center; }
.rule-meta { margin-left: 12px; color: var(--muted); font-size: 12px; }
.rule-note { color: var(--muted); font-size: 13px; margin: 6px 0 10px; }
.data-table.compact th, .data-table.compact td { padding: 6px 8px; }
.rule-editor { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
.rule-editor h3 { margin: 0 0 4px; }
.filter-grow { flex: 1; }
.num-input { width: 90px; }
.editor-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
.link.danger { color: #b42318; }
select, .filter-item input, .rule-editor input { border: 1px solid var(--border); border-radius: 4px; padding: 4px 6px; font-size: 13px; }
</style>
