import {
  manholeDataset,
  resetManholeDataset,
  saveManholeDataset,
} from '@/data/manhole/store'
import {
  addDaysISO,
  describeRule,
  effectiveVersion,
  evaluateCover,
  findRule,
  isAbnormal,
  isPending,
  isValidISODate,
  latestVersion,
  todayISO,
} from '@/data/manhole/rules'
import type {
  CycleRecord,
  ManholeCover,
  ManholeDataset,
  ManholeRule,
  ManholeRuleVersion,
  ManholeStatus,
  ReplaceInput,
  RuleVersionInput,
  ServiceResult,
  StatusEvaluation,
  WorkEvent,
} from '@/data/manhole/types'

export type {
  CycleRecord,
  ManholeCover,
  ManholeRule,
  ManholeRuleVersion,
  ManholeStatus,
  ReplaceInput,
  ServiceResult,
  StatusEvaluation,
  WorkEvent,
} from '@/data/manhole/types'

export interface CoverRow {
  cover: ManholeCover
  evaluation: StatusEvaluation
}

export interface CoverDetail {
  cover: ManholeCover
  evaluation: StatusEvaluation
  cycles: CycleRecord[]
  events: WorkEvent[]
}

export interface ManholeFilters {
  keyword?: string
  status?: string
}

export function listCovers(filters: ManholeFilters = {}): { items: CoverRow[]; total: number } {
  const dataset = manholeDataset()
  const today = todayISO()
  let rows = dataset.covers.map((cover) => ({
    cover,
    evaluation: evaluateCover(cover, dataset.cycles, today, dataset.ruleVersions),
  }))
  const keyword = filters.keyword?.trim()
  if (keyword) {
    rows = rows.filter((row) =>
      [row.cover.coverNo, row.cover.road, row.cover.coverType, row.cover.material]
        .some((value) => value.includes(keyword)),
    )
  }
  if (filters.status && filters.status !== '全部') {
    rows = rows.filter((row) => row.evaluation.status === filters.status)
  }
  return { items: rows, total: rows.length }
}

export function getCover(id: number): CoverDetail | null {
  const dataset = manholeDataset()
  const cover = dataset.covers.find((item) => item.id === id)
  if (!cover) {
    return null
  }
  return {
    cover,
    evaluation: evaluateCover(cover, dataset.cycles, todayISO(), dataset.ruleVersions),
    cycles: dataset.cycles
      .filter((item) => item.coverId === id)
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
    events: dataset.events
      .filter((item) => item.coverId === id)
      .sort((a, b) => (a.date < b.date ? 1 : a.date === b.date ? b.id - a.id : -1)),
  }
}

function nextId(items: { id: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

function persist(dataset: ManholeDataset): void {
  saveManholeDataset(dataset)
}

/** 申请维护：资料齐全且能算出周期的井盖才能申请；重复申请直接拒绝。 */
export function requestMaintenance(id: number): ServiceResult {
  const dataset = manholeDataset()
  const cover = dataset.covers.find((item) => item.id === id)
  if (!cover) {
    return { ok: false, message: '没有找到该井盖设施' }
  }
  const evaluation = evaluateCover(cover, dataset.cycles, todayISO(), dataset.ruleVersions)
  if (cover.phase === '维护中') {
    return { ok: false, message: '井盖正在维护中，不能重复申请' }
  }
  if (cover.phase === '已申请') {
    return { ok: false, message: '已提交过维护申请，等待开工，不用重复申请' }
  }
  if (evaluation.status === '待补充') {
    return { ok: false, message: `暂时不能申请维护：${evaluation.message}` }
  }
  if (evaluation.status === '异常') {
    return { ok: false, message: `暂时不能申请维护：${evaluation.message}` }
  }
  cover.phase = '已申请'
  dataset.events.push({
    id: nextId(dataset.events),
    coverId: cover.id,
    coverNo: cover.coverNo,
    type: '申请维护',
    date: todayISO(),
    detail:
      evaluation.status === '已到期'
        ? `井盖已超期 ${Math.abs(evaluation.daysToDue ?? 0)} 天，提交维护申请`
        : evaluation.status === '待维护'
          ? `距养护到期还有 ${evaluation.daysToDue ?? 0} 天，提交维护申请`
          : '人工提交维护申请',
    ruleVersion: evaluation.ruleVersion,
    ruleText: evaluation.ruleText,
  })
  persist(dataset)
  return { ok: true, message: `已提交维护申请，${cover.coverNo} 当前状态「待维护」` }
}

/** 开始维护：必须先申请。 */
export function startMaintenance(id: number): ServiceResult {
  const dataset = manholeDataset()
  const cover = dataset.covers.find((item) => item.id === id)
  if (!cover) {
    return { ok: false, message: '没有找到该井盖设施' }
  }
  if (cover.phase === '维护中') {
    return { ok: false, message: '井盖已经在维护中，不用重复开工' }
  }
  if (cover.phase !== '已申请') {
    return { ok: false, message: '需要先「申请维护」并通过后才能开始维护' }
  }
  cover.phase = '维护中'
  const evaluation = evaluateCover(cover, dataset.cycles, todayISO(), dataset.ruleVersions)
  dataset.events.push({
    id: nextId(dataset.events),
    coverId: cover.id,
    coverNo: cover.coverNo,
    type: '开始维护',
    date: todayISO(),
    detail: '维护人员开工',
    ruleVersion: evaluation.ruleVersion,
    ruleText: evaluation.ruleText,
  })
  persist(dataset)
  return { ok: true, message: `已开工，${cover.coverNo} 当前状态「维护中」` }
}

/**
 * 确认更换（一个事务内完成，重复确认不会多出周期记录）：
 * 1. 仅维护中的井盖可确认；
 * 2. 校验新类型、材质、规格、安装日期，且规则库能按新类型/材质找到周期标准；
 * 3. 关闭旧周期，按新井盖信息与安装日期对应的规则版本重算并开启唯一一条新周期；
 * 4. 追加一条更换履历（含当时规则快照）。
 */
export function confirmReplacement(id: number, input: ReplaceInput): ServiceResult {
  const dataset = manholeDataset()
  const cover = dataset.covers.find((item) => item.id === id)
  if (!cover) {
    return { ok: false, message: '没有找到该井盖设施' }
  }
  if (cover.phase !== '维护中') {
    return {
      ok: false,
      message:
        cover.phase === '已申请'
          ? '还没有开始维护，不能确认更换'
          : '井盖不在维护中，重复确认更换不会生成新的周期记录',
    }
  }

  const coverType = input.coverType.trim()
  const material = input.material.trim()
  const spec = input.spec.trim()
  const installDate = input.installDate.trim()

  if (!coverType || !material) {
    return { ok: false, message: '请填写新井盖类型与材质' }
  }
  if (!spec) {
    return { ok: false, message: '缺少规格尺寸，更换后将无法建立养护周期' }
  }
  if (!installDate) {
    return { ok: false, message: '缺少安装日期，养护周期无法起算' }
  }
  if (!isValidISODate(installDate)) {
    return { ok: false, message: '安装日期格式无效，应为 YYYY-MM-DD' }
  }
  if (installDate > todayISO()) {
    return { ok: false, message: '安装日期不能晚于今天' }
  }

  const version = effectiveVersion(dataset.ruleVersions, installDate)
  const rule = findRule(version.rules, coverType, material)
  if (!rule) {
    return {
      ok: false,
      message: `规则版本 V${version.version}（${version.effectiveDate} 起生效）中没有「${coverType}/${material}」的养护标准，请先调整规则后再确认更换`,
    }
  }

  // 幂等护栏：同一井盖同时只能有一条进行中的周期。
  const openCycle = dataset.cycles.find(
    (item) => item.coverId === id && item.endDate === null,
  )

  // 1) 追加更换履历（先取事件 id，周期记录引用它，便于事后核对一一对应）。
  const event: WorkEvent = {
    id: nextId(dataset.events),
    coverId: cover.id,
    coverNo: cover.coverNo,
    type: '更换',
    date: installDate,
    detail:
      `确认更换：${cover.coverType}/${cover.material}${cover.spec ? `（${cover.spec}）` : ''} → ` +
      `${coverType}/${material}（${spec}），新安装日期 ${installDate}；旧养护周期关闭，按新井盖重新计算`,
    ruleVersion: version.version,
    ruleText: describeRule(rule),
  }
  dataset.events.push(event)

  // 2) 关闭旧周期（若存在）。
  if (openCycle) {
    openCycle.endDate = installDate
  }

  // 3) 按新井盖类型、材质、安装日期与当时适用规则开启唯一新周期。
  const newCycle: CycleRecord = {
    id: nextId(dataset.cycles),
    coverId: cover.id,
    installDate,
    coverType,
    material,
    spec,
    ruleVersion: version.version,
    rule: { ...rule },
    startDate: installDate,
    dueDate: addDaysISO(installDate, rule.cycleDays),
    endDate: null,
    sourceEventId: event.id,
  }
  dataset.cycles.push(newCycle)

  // 4) 更新井盖本体，重新派生状态。
  cover.coverType = coverType
  cover.material = material
  cover.spec = spec
  cover.installDate = installDate
  cover.phase = '正常'
  cover.replaceCount += 1
  cover.activeCycleId = newCycle.id

  persist(dataset)
  const after = evaluateCover(cover, dataset.cycles, todayISO(), dataset.ruleVersions)
  return {
    ok: true,
    message: `更换完成：新养护周期 ${rule.cycleDays} 天，到期日 ${newCycle.dueDate}，当前状态「${after.status}」`,
  }
}

/** 补充资料：仅待补充井盖可用；补齐后建立唯一周期，已存在周期时不会重复创建。 */
export function supplementInfo(
  id: number,
  input: { installDate: string; spec: string },
): ServiceResult {
  const dataset = manholeDataset()
  const cover = dataset.covers.find((item) => item.id === id)
  if (!cover) {
    return { ok: false, message: '没有找到该井盖设施' }
  }
  const before = evaluateCover(cover, dataset.cycles, todayISO(), dataset.ruleVersions)
  if (before.status !== '待补充') {
    return { ok: false, message: '该井盖资料齐全，无需补充' }
  }

  const installDate = input.installDate.trim()
  const spec = input.spec.trim()
  if (!installDate) {
    return { ok: false, message: '缺少安装日期，养护周期无法起算' }
  }
  if (!isValidISODate(installDate)) {
    return { ok: false, message: '安装日期格式无效，应为 YYYY-MM-DD' }
  }
  if (installDate > todayISO()) {
    return { ok: false, message: '安装日期不能晚于今天' }
  }
  if (!spec) {
    return { ok: false, message: '缺少规格尺寸，无法按规格养护' }
  }

  const version = effectiveVersion(dataset.ruleVersions, installDate)
  const rule = findRule(version.rules, cover.coverType, cover.material)
  if (!rule) {
    return {
      ok: false,
      message: `规则版本 V${version.version} 中没有「${cover.coverType}/${cover.material}」的养护标准，请先调整规则`,
    }
  }

  if (cover.activeCycleId || dataset.cycles.some((c) => c.coverId === id && c.endDate === null)) {
    return { ok: false, message: '该井盖已存在养护周期，补充资料不会重复创建周期记录' }
  }

  const event: WorkEvent = {
    id: nextId(dataset.events),
    coverId: cover.id,
    coverNo: cover.coverNo,
    type: '补充资料',
    date: todayISO(),
    detail: `补充安装日期 ${installDate}、规格尺寸 ${spec}，建立养护周期`,
    ruleVersion: version.version,
    ruleText: describeRule(rule),
  }
  dataset.events.push(event)

  const cycle: CycleRecord = {
    id: nextId(dataset.cycles),
    coverId: cover.id,
    installDate,
    coverType: cover.coverType,
    material: cover.material,
    spec,
    ruleVersion: version.version,
    rule: { ...rule },
    startDate: installDate,
    dueDate: addDaysISO(installDate, rule.cycleDays),
    endDate: null,
    sourceEventId: event.id,
  }
  dataset.cycles.push(cycle)

  cover.installDate = installDate
  cover.spec = spec
  cover.activeCycleId = cycle.id

  persist(dataset)
  const after = evaluateCover(cover, dataset.cycles, todayISO(), dataset.ruleVersions)
  return {
    ok: true,
    message: `资料已补充：养护周期 ${rule.cycleDays} 天，到期日 ${cycle.dueDate}，当前状态「${after.status}」`,
  }
}

/** 历史维护工作台：只追加不改写，每条都带当时适用的规则版本与描述。 */
export function listWorkEvents(): WorkEvent[] {
  const dataset = manholeDataset()
  return [...dataset.events].sort((a, b) =>
    a.date < b.date ? 1 : a.date === b.date ? b.id - a.id : -1,
  )
}

export function listRuleVersions() {
  return [...manholeDataset().ruleVersions].sort((a, b) => (a.version < b.version ? 1 : -1))
}

/**
 * 调整规则：只能新增（或更新今天刚生效、尚未用于任何历史判定的）版本。
 * 历史版本不可修改，规则调整只影响之后开始计算的周期。
 */
export function saveRuleVersion(input: RuleVersionInput): ServiceResult {
  const dataset = manholeDataset()
  const effectiveDate = input.effectiveDate.trim()
  const note = input.note.trim()
  if (!isValidISODate(effectiveDate)) {
    return { ok: false, message: '生效日期格式无效，应为 YYYY-MM-DD' }
  }
  if (effectiveDate < todayISO()) {
    return { ok: false, message: '生效日期不能早于今天：规则调整只影响之后的判定，历史记录按当时标准保留' }
  }
  if (!note) {
    return { ok: false, message: '请填写本次调整说明' }
  }
  if (input.rules.length === 0) {
    return { ok: false, message: '至少保留一条养护规则' }
  }
  const seen = new Set<string>()
  for (const rule of input.rules) {
    const key = `${rule.coverType}|${rule.material}`
    if (seen.has(key)) {
      return { ok: false, message: `「${rule.coverType}/${rule.material}」重复配置` }
    }
    seen.add(key)
    if (!rule.coverType.trim() || !rule.material.trim()) {
      return { ok: false, message: '规则的井盖类型与材质不能为空' }
    }
    if (!Number.isInteger(rule.cycleDays) || rule.cycleDays <= 0) {
      return { ok: false, message: `「${key}」的养护周期必须是正整数` }
    }
    if (!Number.isInteger(rule.warnDays) || rule.warnDays < 0) {
      return { ok: false, message: `「${key}」的预警天数不能为负` }
    }
    if (rule.warnDays >= rule.cycleDays) {
      return { ok: false, message: `「${key}」的预警天数必须小于养护周期` }
    }
  }

  const existing = dataset.ruleVersions.find((v) => v.effectiveDate === effectiveDate)
  if (existing) {
    if (existing.effectiveDate < todayISO()) {
      return { ok: false, message: '该版本已对历史判定生效，不能修改，请新建版本' }
    }
    existing.note = note
    existing.rules = input.rules.map((r) => ({ ...r }))
    persist(dataset)
    return { ok: true, message: `规则版本 V${existing.version}（${effectiveDate} 生效）已更新，仅影响之后的判定` }
  }

  const version = latestVersion(dataset.ruleVersions).version + 1
  dataset.ruleVersions.push({
    version,
    effectiveDate,
    createdAt: todayISO(),
    note,
    rules: input.rules.map((r) => ({ ...r })),
  })
  persist(dataset)
  return { ok: true, message: `已发布规则版本 V${version}，${effectiveDate} 起生效，历史记录不受影响` }
}

export interface ManholeOverview {
  total: number
  pending: number
  inProgress: number
  due: number
  needInfo: number
  abnormal: number
  replaced: number
  byStatus: { status: ManholeStatus; count: number }[]
}

const ALL_STATUSES: ManholeStatus[] = ['正常', '待维护', '维护中', '已到期', '待补充', '异常']

export function manholeOverview(): ManholeOverview {
  const rows = listCovers().items
  const byStatus = ALL_STATUSES.map((status) => ({
    status,
    count: rows.filter((row) => row.evaluation.status === status).length,
  }))
  return {
    total: rows.length,
    pending: rows.filter((r) => r.evaluation.status === '待维护' || r.evaluation.status === '已到期').length,
    inProgress: byStatus.find((s) => s.status === '维护中')!.count,
    due: byStatus.find((s) => s.status === '已到期')!.count,
    needInfo: byStatus.find((s) => s.status === '待补充')!.count,
    abnormal: rows.filter((r) => isAbnormal(r.evaluation.status)).length,
    replaced: rows.filter((r) => r.cover.replaceCount > 0).length,
    byStatus,
  }
}

/** 供运营概览复用：pending/abnormal 口径与通用模块对齐。 */
export function manholeOverviewFlags(): { created: number; pending: number; abnormal: number } {
  const rows = listCovers().items
  return {
    created: rows.length,
    pending: rows.filter((r) => isPending(r.evaluation.status)).length,
    abnormal: rows.filter((r) => isAbnormal(r.evaluation.status)).length,
  }
}

export function resetManhole(): void {
  resetManholeDataset()
}

export function exportManholeCSV(): { filename: string; content: string } {
  const { items } = listCovers()
  const header = [
    '井盖编号', '所属道路', '井盖类型', '井盖材质', '规格尺寸', '安装日期',
    '养护周期(天)', '预警天数', '到期日', '当前状态', '判定说明', '更换次数',
  ]
  const lines = [header.join(',')]
  for (const row of items) {
    const c = row.cover
    const e = row.evaluation
    lines.push(
      [
        c.coverNo, c.road, c.coverType, c.material, c.spec || '缺失',
        c.installDate || '缺失', e.cycleDays ?? '—', e.warnDays ?? '—',
        e.dueDate ?? '—', e.status, e.message, c.replaceCount,
      ]
        .map((value) => String(value).replace(/,/g, '，'))
        .join(','),
    )
  }
  return { filename: '井盖设施-清单.csv', content: `﻿${lines.join('\n')}` }
}

export function downloadManholeCSV(): void {
  const { filename, content } = exportManholeCSV()
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

/** 详情页展示「距到期天数」时复用同一计算，避免与列表口径不一致。 */
export function daysText(evaluation: StatusEvaluation): string {
  if (evaluation.daysToDue === null) {
    return '—'
  }
  return evaluation.daysToDue < 0
    ? `已超期 ${Math.abs(evaluation.daysToDue)} 天`
    : `剩余 ${evaluation.daysToDue} 天`
}
