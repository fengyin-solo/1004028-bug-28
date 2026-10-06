import type {
  CycleRecord,
  ManholeCover,
  ManholeRule,
  ManholeRuleVersion,
  ManholeStatus,
  StatusEvaluation,
  StatusReason,
} from './types'

export const COVER_TYPES = ['雨水检查井', '污水检查井', '电力检查井', '燃气检查井', '热力检查井']
export const MATERIALS = ['球墨铸铁', '复合材料', '水泥钢纤维']

/** V1 基线规则：长期有效（生效日很早），所有初始周期都适用。 */
export const V1_RULE_VERSION: ManholeRuleVersion = {
  version: 1,
  effectiveDate: '2020-01-01',
  createdAt: '2020-01-01',
  note: '初始养护标准：不同井盖类型、材质适用不同养护周期。',
  rules: [
    { coverType: '雨水检查井', material: '球墨铸铁', cycleDays: 180, warnDays: 30 },
    { coverType: '雨水检查井', material: '复合材料', cycleDays: 120, warnDays: 20 },
    { coverType: '雨水检查井', material: '水泥钢纤维', cycleDays: 240, warnDays: 30 },
    { coverType: '污水检查井', material: '球墨铸铁', cycleDays: 180, warnDays: 30 },
    { coverType: '污水检查井', material: '复合材料', cycleDays: 90, warnDays: 15 },
    { coverType: '污水检查井', material: '水泥钢纤维', cycleDays: 240, warnDays: 30 },
    { coverType: '电力检查井', material: '球墨铸铁', cycleDays: 365, warnDays: 45 },
    { coverType: '电力检查井', material: '复合材料', cycleDays: 180, warnDays: 30 },
    { coverType: '电力检查井', material: '水泥钢纤维', cycleDays: 365, warnDays: 45 },
    { coverType: '燃气检查井', material: '球墨铸铁', cycleDays: 90, warnDays: 15 },
    { coverType: '燃气检查井', material: '复合材料', cycleDays: 60, warnDays: 10 },
    { coverType: '燃气检查井', material: '水泥钢纤维', cycleDays: 120, warnDays: 20 },
  ],
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function todayISO(): string {
  const now = new Date()
  return toISODate(now.getTime())
}

export function toISODate(time: number): string {
  const d = new Date(time)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isValidISODate(value: string): boolean {
  if (typeof value !== 'string' || !ISO_DATE.test(value.trim())) {
    return false
  }
  const [y, m, d] = value.trim().split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  )
}

/** 按 UTC 解析，避免本地时区把日期挪到前一天。 */
function parseUTC(value: string): number {
  const [y, m, d] = value.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** b - a 的天数差（按日历日）。 */
export function diffDays(a: string, b: string): number {
  return Math.round((parseUTC(b) - parseUTC(a)) / 86_400_000)
}

export function addDaysISO(value: string, days: number): string {
  return toISODate(parseUTC(value) + days * 86_400_000)
}

export function describeRule(rule: ManholeRule | null): string {
  if (!rule) {
    return '无适用养护标准'
  }
  return `${rule.coverType}/${rule.material}：周期 ${rule.cycleDays} 天，到期前 ${rule.warnDays} 天预警`
}

export function findRule(
  rules: ManholeRule[],
  coverType: string,
  material: string,
): ManholeRule | null {
  return (
    rules.find((item) => item.coverType === coverType && item.material === material) ?? null
  )
}

/**
 * 取某日期（周期开始日）适用的规则版本：生效日 <= 该日期的最新版本。
 * 规则调整生成新版本后，历史周期仍按创建时的版本快照判定，互不影响。
 */
export function effectiveVersion(
  versions: ManholeRuleVersion[],
  date: string,
): ManholeRuleVersion {
  const candidates = versions
    .filter((v) => v.effectiveDate <= date)
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1))
  return candidates[0] ?? V1_RULE_VERSION
}

export function latestVersion(versions: ManholeRuleVersion[]): ManholeRuleVersion {
  return [...versions].sort((a, b) => (a.version < b.version ? 1 : -1))[0] ?? V1_RULE_VERSION
}

const REASON_MESSAGES: Record<StatusReason, (ctx: StatusEvaluation) => string> = {
  in_progress: () => '井盖正在维护中',
  requested: () => '已提交维护申请，等待开工',
  missing_install_date: () => '缺少安装日期，无法计算养护周期，请补充资料',
  missing_spec: () => '缺少规格尺寸，无法按规格养护，请补充资料',
  invalid_install_date: (ctx) => `安装日期「${ctx.startDate ?? ''}」格式无效，应为 YYYY-MM-DD`,
  rule_not_found: (ctx) =>
    `当前规则版本 V${ctx.ruleVersion ?? '-'} 中没有「${ctx.ruleText}」对应的养护标准，无法计算周期`,
  overdue: (ctx) =>
    `已超过养护周期 ${Math.abs(ctx.daysToDue ?? 0)} 天（应在 ${ctx.dueDate ?? '-'} 前完成养护）`,
  due_soon: (ctx) =>
    `距养护到期还有 ${ctx.daysToDue ?? 0} 天（应在 ${ctx.dueDate ?? '-'} 前完成养护）`,
  normal: (ctx) =>
    `养护周期 ${ctx.cycleDays ?? '-'} 天，下次到期日 ${ctx.dueDate ?? '-'}，状态正常`,
}

function build(
  status: ManholeStatus,
  reason: StatusReason,
  partial: Partial<StatusEvaluation>,
): StatusEvaluation {
  const base: StatusEvaluation = {
    status,
    reason,
    message: '',
    cycleId: null,
    cycleDays: null,
    warnDays: null,
    startDate: null,
    dueDate: null,
    daysToDue: null,
    ruleVersion: null,
    ruleText: '',
    ...partial,
  }
  base.message = REASON_MESSAGES[reason](base)
  return base
}

/**
 * 统一状态判定。列表、详情、待办统计全部走这里，确保结果一致。
 * 判定只使用周期记录里保存的规则快照，规则后续调整不影响既有周期；
 * 资料齐全但找不到适用规则时，借助规则版本表判为「异常」并说明缺的是哪项标准。
 */
export function evaluateCover(
  cover: ManholeCover,
  cycles: CycleRecord[],
  onDate: string = todayISO(),
  ruleVersions: ManholeRuleVersion[] | null = null,
): StatusEvaluation {
  if (cover.phase === '维护中') {
    return build('维护中', 'in_progress', {})
  }
  if (cover.phase === '已申请') {
    return build('待维护', 'requested', {})
  }

  if (!cover.installDate.trim()) {
    return build('待补充', 'missing_install_date', {})
  }
  if (!isValidISODate(cover.installDate)) {
    return build('异常', 'invalid_install_date', { startDate: cover.installDate })
  }
  if (!cover.spec.trim()) {
    return build('待补充', 'missing_spec', { startDate: cover.installDate })
  }

  const cycle = cover.activeCycleId
    ? cycles.find((item) => item.id === cover.activeCycleId) ?? null
    : null
  if (!cycle) {
    // 资料齐全却没有周期：查规则版本表，区分「无养护标准」与其他异常。
    if (ruleVersions) {
      const version = effectiveVersion(ruleVersions, cover.installDate)
      if (!findRule(version.rules, cover.coverType, cover.material)) {
        return build('异常', 'rule_not_found', {
          ruleVersion: version.version,
          startDate: cover.installDate,
          ruleText: `${cover.coverType}/${cover.material}`,
        })
      }
    }
    return build('待补充', 'missing_install_date', { startDate: cover.installDate })
  }

  const rule = cycle.rule
  if (!rule) {
    return build('异常', 'rule_not_found', {
      cycleId: cycle.id,
      ruleVersion: cycle.ruleVersion,
      startDate: cycle.startDate,
      ruleText: `${cycle.coverType}/${cycle.material}`,
    })
  }

  const daysToDue = diffDays(onDate, cycle.dueDate)
  const common = {
    cycleId: cycle.id,
    cycleDays: rule.cycleDays,
    warnDays: rule.warnDays,
    startDate: cycle.startDate,
    dueDate: cycle.dueDate,
    daysToDue,
    ruleVersion: cycle.ruleVersion,
    ruleText: describeRule(rule),
  }
  if (daysToDue < 0) {
    return build('已到期', 'overdue', common)
  }
  if (daysToDue <= rule.warnDays) {
    return build('待维护', 'due_soon', common)
  }
  return build('正常', 'normal', common)
}

/** 运营概览里的「待处理 / 异常」口径。 */
export function isPending(status: ManholeStatus): boolean {
  return status === '待维护' || status === '维护中' || status === '已到期' || status === '待补充'
}

export function isAbnormal(status: ManholeStatus): boolean {
  return status === '异常'
}
