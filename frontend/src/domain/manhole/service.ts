import { saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, FieldValue, ManholeCycleRecord } from '@/data/types'

import {
  appendCycleRecord,
  listCycleRecords,
  resetCycleRecords,
} from './cycle-store'
import {
  diffDays,
  evaluateClosedCycle,
  evaluateCover,
  type CoverEvaluation,
  type DerivedStatus,
} from './rules'

export type ReplacementInput = {
  coverType: string
  material: string
  spec: string
  installDate: string
}

export type ManholeViewRow = {
  id: number
  status: DerivedStatus
  pending: boolean
  abnormal: boolean
  phase: string
  raw: EntryRow
  cycleText: string
  dueText: string
  reasons: string[]
  ruleLabel: string
  evaluation: CoverEvaluation
}

// 演示项目没有后端时钟注入，统一以“今天”为基准；页面与种子数据都围绕它。
function todayISO(): string {
  return '2026-10-06'
}

function fieldText(row: EntryRow, field: string): string {
  const value: FieldValue | undefined = row[field]
  return String(value ?? '').trim()
}

function isPendingStatus(status: DerivedStatus): boolean {
  return status === '待维护' || status === '待补充' || status === '维护中'
}

/** 列表与详情共用：同一块井盖只在这里算一次状态，两处结果必然一致。 */
export function deriveManhole(row: EntryRow): ManholeViewRow {
  const evaluation = evaluateCover(row, todayISO())
  return {
    id: Number(row.id),
    status: evaluation.status,
    pending: isPendingStatus(evaluation.status),
    abnormal: evaluation.abnormal,
    phase: String(row.phase ?? 'in_service'),
    raw: row,
    cycleText: evaluation.cycleMonths === null ? '—' : `${evaluation.cycleMonths} 个月`,
    dueText: evaluation.dueDate ?? '—',
    reasons: evaluation.reasons,
    ruleLabel: evaluation.ruleLabel,
    evaluation,
  }
}

export function deriveManholeRows(rows: EntryRow[]): ManholeViewRow[] {
  return rows.map(deriveManhole)
}

function findView(rows: EntryRow[], id: number): EntryRow | null {
  return rows.find((row) => Number(row.id) === id) ?? null
}

function persist(rows: EntryRow[], index: number, next: EntryRow): void {
  // 落库前同步派生状态，保证直接读取存储的通用视图（如运营概览）也与列表一致。
  const derived = deriveManhole(next)
  const synced: EntryRow = {
    ...next,
    status: derived.status,
    pending: derived.pending,
    abnormal: derived.abnormal,
    养护周期: derived.cycleText,
    应办日期: derived.dueText,
    判定说明: derived.reasons.join('；'),
    规则版本: derived.ruleLabel,
  }
  const updated = [...rows]
  updated[index] = synced
  saveRows('manhole', updated)
}

export function applyForMaintenance(rows: EntryRow[], id: number): ActionResult {
  const index = rows.findIndex((row) => Number(row.id) === id)
  const current = index >= 0 ? deriveManhole(rows[index]) : null
  if (!current) {
    return { ok: false, message: `没有找到编号为 ${id} 的井盖设施` }
  }
  if (current.phase === 'maintaining') {
    return { ok: false, message: '井盖已在维护中，不用重复申请' }
  }
  if (current.status === '待补充') {
    return { ok: false, message: `档案不完整，补齐后才能申请维护：${current.reasons.join('；')}` }
  }
  if (current.status === '异常') {
    return { ok: false, message: `井盖存在异常，处理后才能申请维护：${current.reasons.join('；')}` }
  }
  if (current.raw.requested === true && current.status === '待维护') {
    return { ok: false, message: '维护申请已提交，等待开工' }
  }
  const next: EntryRow = { ...current.raw, requested: true }
  persist(rows, index, next)
  return { ok: true, message: '已登记维护申请，井盖进入待维护' }
}

export function startMaintenance(rows: EntryRow[], id: number): ActionResult {
  const index = rows.findIndex((row) => Number(row.id) === id)
  const current = index >= 0 ? deriveManhole(rows[index]) : null
  if (!current) {
    return { ok: false, message: `没有找到编号为 ${id} 的井盖设施` }
  }
  if (current.phase === 'maintaining') {
    return { ok: false, message: '井盖已经在维护中' }
  }
  if (current.status !== '待维护') {
    return { ok: false, message: `当前判定为「${current.status}」，只有待维护的井盖可以开始维护` }
  }
  const next: EntryRow = { ...current.raw, phase: 'maintaining' }
  persist(rows, index, next)
  return { ok: true, message: '井盖已开始维护' }
}

/**
 * 确认更换：按新井盖的类型、材质、安装日期重算规则与状态。
 * 旧井盖的使用过程按更换日生效的规则版本冻结为一条周期记录；
 * 阶段守卫保证重复确认不会多出周期记录。
 */
export function confirmReplacement(
  rows: EntryRow[],
  id: number,
  input: ReplacementInput,
): ActionResult {
  const index = rows.findIndex((row) => Number(row.id) === id)
  const row = findView(rows, id)
  if (index < 0 || !row) {
    return { ok: false, message: `没有找到编号为 ${id} 的井盖设施` }
  }
  const current = deriveManhole(row)
  if (current.phase !== 'maintaining') {
    return { ok: false, message: '只有维护中的井盖可以确认更换，重复确认不会重复生成周期记录' }
  }

  const coverType = input.coverType.trim()
  const material = input.material.trim()
  const spec = input.spec.trim()
  const installDate = input.installDate.trim()
  if (!installDate || !spec || !coverType || !material) {
    return { ok: false, message: '更换信息不完整：井盖类型、材质、规格尺寸、安装日期都必须填写' }
  }
  if (installDate > todayISO()) {
    return { ok: false, message: `安装日期 ${installDate} 不能晚于当前日期` }
  }

  const code = fieldText(row, '井盖编号')
  const oldStartDate = fieldText(row, '安装日期')
  const oldSpec = fieldText(row, '规格尺寸')
  const oldType = fieldText(row, '井盖类型')
  const oldMaterial = fieldText(row, '井盖材质')
  const replacedAt = todayISO()

  // 旧件按“当时标准”冻结周期记录。
  const closed = evaluateClosedCycle({
    coverType: oldType,
    material: oldMaterial,
    spec: oldSpec,
    startDate: oldStartDate,
    replacedAt,
  })
  const daysUsed = oldStartDate ? diffDays(oldStartDate, replacedAt) : 0
  const record: ManholeCycleRecord = {
    id: nextCycleId(),
    manholeId: id,
    manholeCode: code,
    coverType: oldType,
    material: oldMaterial,
    spec: oldSpec,
    startDate: oldStartDate,
    replacedAt,
    daysUsed,
    cycleMonths: closed.rule ? closed.rule.cycleMonths : null,
    ruleVersion: closed.version.version,
    ruleLabel: closed.version.label,
    dueDate: closed.dueDate,
    conclusion: closed.conclusion,
    reasons: closed.reasons,
  }

  // 新井盖：类型、材质、规格、安装日期全部以本次确认为准；阶段回到在册，周期重新起算。
  const replaced: EntryRow = {
    ...row,
    井盖类型: coverType,
    井盖材质: material,
    规格尺寸: spec,
    安装日期: installDate,
    phase: 'in_service',
    requested: false,
    最近更换日期: replacedAt,
  }
  const derived = deriveManhole(replaced)
  appendCycleRecord(record)
  persist(rows, index, replaced)

  const tail =
    derived.status === '正常'
      ? `新井盖周期自 ${installDate} 起算，当前「正常」`
      : `新井盖当前判定为「${derived.status}」：${derived.reasons.join('；')}`
  return {
    ok: true,
    message: `已确认更换：周期记录按当时《${closed.version.label}》冻结（结论：${closed.conclusion}）。${tail}`,
  }
}

function nextCycleId(): number {
  return listCycleRecords().reduce((max, item) => Math.max(max, item.id), 0) + 1
}

export type ManholeHistoryRow = {
  recordId: number
  manholeId: number
  manholeCode: string
  coverType: string
  material: string
  spec: string
  startDate: string
  replacedAt: string
  daysUsed: number
  cycleText: string
  ruleLabel: string
  dueText: string
  conclusion: ManholeCycleRecord['conclusion']
  reasons: string[]
}

/** 历史维护工作台：只读取冻结记录，规则调整不改变这里的任何结论。 */
export function listManholeHistory(
  filters: { manholeCode?: string; ruleVersion?: string } = {},
): ManholeHistoryRow[] {
  const code = filters.manholeCode?.trim() ?? ''
  const version = filters.ruleVersion?.trim() ?? ''
  return listCycleRecords()
    .filter((record) => (code ? record.manholeCode.includes(code) : true))
    .filter((record) => (version ? record.ruleVersion === version : true))
    .sort((a, b) => b.replacedAt.localeCompare(a.replacedAt))
    .map((record) => ({
      recordId: record.id,
      manholeId: record.manholeId,
      manholeCode: record.manholeCode,
      coverType: record.coverType,
      material: record.material,
      spec: record.spec,
      startDate: record.startDate,
      replacedAt: record.replacedAt,
      daysUsed: record.daysUsed,
      cycleText: record.cycleMonths === null ? '无适用规则' : `${record.cycleMonths} 个月`,
      ruleLabel: record.ruleLabel,
      dueText: record.dueDate ?? '—',
      conclusion: record.conclusion,
      reasons: record.reasons,
    }))
}

export { resetCycleRecords as resetManholeCycles }

const CSV_HEADER = [
  '编号',
  '井盖编号',
  '所属道路',
  '井盖类型',
  '井盖材质',
  '规格尺寸',
  '安装日期',
  '养护周期',
  '应办日期',
  '当前状态',
  '判定说明',
  '规则版本',
]

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function exportManholeRows(rows: EntryRow[]): { filename: string; content: string } {
  const lines = [CSV_HEADER.join(',')]
  for (const row of deriveManholeRows(rows)) {
    const raw = row.raw
    lines.push(
      [
        raw.id,
        raw['井盖编号'],
        raw['所属道路'],
        raw['井盖类型'],
        raw['井盖材质'],
        raw['规格尺寸'],
        raw['安装日期'],
        row.cycleText,
        row.dueText,
        row.status,
        row.reasons.join('；'),
        row.ruleLabel,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return { filename: '井盖设施-清单.csv', content: `﻿${lines.join('\n')}` }
}
