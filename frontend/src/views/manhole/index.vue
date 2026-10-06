<template>
  <section class="page" data-module="manhole">
    <header class="page-head">
      <div>
        <h2>井盖设施管理</h2>
        <p class="page-desc">围绕井盖编号、所属道路、井盖类型、井盖材质做登记与状态流转；状态由养护规则按安装日期统一判定，列表与详情一致。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记井盖设施</button>
        <button class="btn" type="button" @click="exportRows">导出当前台账</button>
      </div>
    </header>

    <div class="tab-bar">
      <button class="tab" :class="{ active: tab === 'current' }" type="button" @click="tab = 'current'">
        当前井盖台账
      </button>
      <button class="tab" :class="{ active: tab === 'history' }" type="button" @click="tab = 'history'">
        历史维护工作台
      </button>
    </div>

    <template v-if="tab === 'current'">
      <div class="stat-row">
        <article v-for="item in stats" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
      </div>

      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <form class="filter-bar" @submit.prevent="reload">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>应办日期</th>
            <th>判定说明</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in viewRows" :key="row.id">
            <td>{{ text(row.raw['井盖编号']) }}</td>
            <td>{{ text(row.raw['所属道路']) }}</td>
            <td>{{ text(row.raw['井盖类型']) }}</td>
            <td>{{ text(row.raw['井盖材质']) }}</td>
            <td>{{ text(row.raw['规格尺寸']) || '—' }}</td>
            <td>{{ text(row.raw['安装日期']) || '—' }}</td>
            <td>{{ row.cycleText }}</td>
            <td>{{ row.dueText }}</td>
            <td class="reason-cell" :title="row.reasons.join('；')">{{ row.reasons.join('；') || '—' }}</td>
            <td>
              <span class="status-pill" :data-status="row.status">{{ row.status }}</span>
            </td>
            <td class="row-actions">
              <button class="link" type="button" @click="openDetail(row.id)">详情</button>
              <button
                v-if="row.phase === 'in_service' && row.raw.requested !== true && row.status !== '待补充' && row.status !== '异常'"
                class="link"
                type="button"
                @click="runAction('申请维护', row.id)"
              >
                申请维护
              </button>
              <button
                v-if="(row.phase === 'in_service' && (row.status === '待维护' || row.raw.requested === true))"
                class="link"
                type="button"
                @click="runAction('开始维护', row.id)"
              >
                开始维护
              </button>
            </td>
          </tr>
          <tr v-if="!viewRows.length">
            <td :colspan="columns.length + 3" class="empty-state">暂无符合条件的井盖设施数据</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ total }} 条井盖设施记录 · 判定基准日 {{ TODAY }}</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>

    <template v-else>
      <p class="page-desc" style="margin: 8px 0 12px">
        历史维护工作台展示确认更换时冻结的养护周期记录，始终按更换当时生效的规则版本保留结论；之后的规则调整只影响新判定，不回改历史。
      </p>
      <form class="filter-bar" @submit.prevent="loadHistory">
        <label class="filter-item">
          <span>井盖编号</span>
          <input v-model="historyFilters.manholeCode" placeholder="按井盖编号检索" />
        </label>
        <label class="filter-item">
          <span>规则版本</span>
          <select v-model="historyFilters.ruleVersion">
            <option value="">全部版本</option>
            <option v-for="version in ruleVersions" :key="version.version" :value="version.version">
              {{ version.label }}
            </option>
          </select>
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetHistoryFilters">重置条件</button>
      </form>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in historyColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in historyRows" :key="row.recordId">
            <td>{{ row.manholeCode }}</td>
            <td>{{ row.coverType }}</td>
            <td>{{ row.material }}</td>
            <td>{{ row.spec || '—' }}</td>
            <td>{{ row.startDate || '—' }}</td>
            <td>{{ row.replacedAt }}</td>
            <td>{{ row.daysUsed }}</td>
            <td>{{ row.cycleText }}</td>
            <td>{{ row.dueText }}</td>
            <td>
              <span class="status-pill" :data-status="row.conclusion">{{ row.conclusion }}</span>
            </td>
            <td class="reason-cell" :title="row.reasons.join('；')">{{ row.reasons.join('；') }}</td>
            <td>{{ row.ruleLabel }}</td>
            <td>
              <button class="link" type="button" @click="openDetail(row.manholeId)">查看井盖</button>
            </td>
          </tr>
          <tr v-if="!historyRows.length">
            <td :colspan="historyColumns.length" class="empty-state">暂无历史养护周期记录</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>共 {{ historyRows.length }} 条周期记录（历史结论已冻结）</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { runAction as applyAction } from '@/api/local-service'
import { listRows } from '@/data/local-store'
import { MANHOLE_RULE_VERSIONS } from '@/domain/manhole/rules'
import {
  deriveManholeRows,
  exportManholeRows,
  listManholeHistory,
  type ManholeHistoryRow,
  type ManholeViewRow,
} from '@/domain/manhole/service'

const router = useRouter()
const TODAY = '2026-10-06'

const columns = ['井盖编号', '所属道路', '井盖类型', '井盖材质', '规格尺寸', '安装日期', '养护周期']
const historyColumns = [
  '井盖编号', '井盖类型', '井盖材质', '规格尺寸', '安装日期', '更换日期',
  '实际使用天数', '当时周期', '当时应办日期', '更换时结论', '判定说明（哪项条件不满足）', '适用规则版本', '操作',
]
const statuses = ['正常', '待维护', '维护中', '待补充', '异常', '已更换']

const tab = ref<'current' | 'history'>('current')
const viewRows = ref<ManholeViewRow[]>([])
const historyRows = ref<ManholeHistoryRow[]>([])
const total = computed(() => viewRows.value.length)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['井盖编号', '所属道路', '井盖类型']
const historyFilters = ref<{ manholeCode: string; ruleVersion: string }>({ manholeCode: '', ruleVersion: '' })
const ruleVersions = MANHOLE_RULE_VERSIONS

const stats = computed(() => {
  const count = (status: string) => viewRows.value.filter((row) => row.status === status).length
  return [
    { label: '井盖总数', value: viewRows.value.length },
    { label: '正常', value: count('正常') },
    { label: '待维护', value: count('待维护') },
    { label: '维护中', value: count('维护中') },
    { label: '待补充', value: count('待补充') },
    { label: '异常', value: count('异常') },
    { label: '本周期已更换', value: viewRows.value.filter((row) => text(row.raw['最近更换日期'])).length },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: viewRows.value.filter((row) => row.status === status).length,
  })),
)

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function resetHistoryFilters() {
  historyFilters.value = { manholeCode: '', ruleVersion: '' }
  loadHistory()
}

function exportRows() {
  const { filename, content } = exportManholeRows(listRows('manhole'))
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function openCreate() {
  errorMessage.value = '井盖设施登记入口尚未接入审批流'
}

function openDetail(id: number) {
  router.push({ name: 'manhole-detail', params: { id } })
}

function runAction(action: string, id: number) {
  errorMessage.value = ''
  const result = applyAction('manhole', id, action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const pairs = Object.entries(filters.value).filter(([, value]) => value.trim() !== '')
    const rows = listRows('manhole').filter((row) =>
      pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
    )
    viewRows.value = deriveManholeRows(rows)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '井盖设施列表读取失败'
  }
}

function loadHistory() {
  errorMessage.value = ''
  historyRows.value = listManholeHistory(historyFilters.value)
}

onMounted(() => {
  reload()
  loadHistory()
})
</script>

<style scoped>
.tab-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.tab { border: 1px solid var(--border); background: #fff; border-radius: 6px 6px 0 0; padding: 6px 16px; cursor: pointer; font-size: 13px; }
.tab.active { background: var(--brand); border-color: var(--brand); color: #fff; }
.reason-cell { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
.status-pill { border-radius: 999px; padding: 2px 10px; font-size: 12px; background: #eef2f7; }
.status-pill[data-status='正常'] { background: #dcfce7; color: #166534; }
.status-pill[data-status='待维护'] { background: #fef3c7; color: #92400e; }
.status-pill[data-status='维护中'] { background: #dbeafe; color: #1e40af; }
.status-pill[data-status='待补充'] { background: #f3e8ff; color: #6b21a8; }
.status-pill[data-status='异常'] { background: #fee2e2; color: #991b1b; }
.status-pill[data-status='已更换'] { background: #e0f2fe; color: #075985; }
</style>
