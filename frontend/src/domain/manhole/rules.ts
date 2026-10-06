import type { EntryRow, FieldValue } from '@/data/types'

// 井盖养护规则：按「井盖类型 + 井盖材质」决定养护周期（月）。
// 规则带版本：2024 版是旧标准，2026 版是现行标准。调整规则只追加新版本，
// 历史周期记录在生成时已冻结所用版本，不随规则调整被改写。

export type CoverRule = {
  coverType: string
  material: string
  cycleMonths: number
  note: string
}

export type RuleVersion = {
  version: string
  label: string
  effectiveFrom: string
  rules: CoverRule[]
}

export const MANHOLE_RULE_VERSIONS: RuleVersion[] = [
  {
    version: 'v2024',
    label: '2024 版养护标准（2026 年 1 月前沿用）',
    effectiveFrom: '2020-01-01',
    rules: [
      { coverType: '雨水井', material: '球墨铸铁', cycleMonths: 12, note: '路面承载井盖年度养护' },
      { coverType: '污水井', material: '球墨铸铁', cycleMonths: 12, note: '路面承载井盖年度养护' },
      { coverType: '雨水井', material: '复合材料', cycleMonths: 6, note: '复合材料井盖半年养护' },
      { coverType: '污水井', material: '复合材料', cycleMonths: 6, note: '复合材料井盖半年养护' },
      { coverType: '雨水井', material: '钢筋混凝土', cycleMonths: 24, note: '混凝土井盖两年养护' },
      { coverType: '污水井', material: '钢筋混凝土', cycleMonths: 24, note: '混凝土井盖两年养护' },
    ],
  },
  {
    version: 'v2026',
    label: '2026 版养护标准（现行）',
    effectiveFrom: '2026-01-01',
    rules: [
      { coverType: '雨水井', material: '球墨铸铁', cycleMonths: 12, note: '现行：铸铁路面井盖年度养护' },
      { coverType: '污水井', material: '球墨铸铁', cycleMonths: 12, note: '现行：铸铁路面井盖年度养护' },
      { coverType: '雨水井', material: '复合材料', cycleMonths: 12, note: '现行：复合材料由 6 个月放宽到 12 个月' },
      { coverType: '污水井', material: '复合材料', cycleMonths: 12, note: '现行：复合材料由 6 个月放宽到 12 个月' },
      { coverType: '雨水井', material: '钢筋混凝土', cycleMonths: 18, note: '现行：混凝土由 24 个月收紧到 18 个月' },
      { coverType: '污水井', material: '钢筋混凝土', cycleMonths: 18, note: '现行：混凝土由 24 个月收紧到 18 个月' },
    ],
  },
]

export type DerivedStatus = '正常' | '待维护' | '维护中' | '待补充' | '异常' | '已更换'

export type CoverEvaluation = {
  status: DerivedStatus
  reasons: string[]
  ruleVersion: string
  ruleLabel: string
  ruleNote: string
  cycleMonths: number | null
  installDate: string
  dueDate: string | null
  abnormal: boolean
}

function text(value: FieldValue | undefined): string {
  return String(value ?? '').trim()
}

/** 在指定日期生效的规则版本：取生效日不晚于该日期的最新版本。 */
export function ruleVersionAt(dateISO: string): RuleVersion {
  return (
    MANHOLE_RULE_VERSIONS.filter((item) => item.effectiveFrom <= dateISO).sort((a, b) =>
      b.effectiveFrom.localeCompare(a.effectiveFrom),
    )[0] ?? MANHOLE_RULE_VERSIONS[0]
  )
}

/** 当前现行规则版本（按今天）。 */
export function currentRuleVersion(todayISO: string): RuleVersion {
  return ruleVersionAt(todayISO)
}

function findRule(version: RuleVersion, coverType: string, material: string): CoverRule | null {
  return (
    version.rules.find(
      (rule) => rule.coverType === coverType && rule.material === material,
    ) ?? null
  )
}

export function addMonths(dateISO: string, months: number): string {
  const [year, month, day] = dateISO.split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target.toISOString().slice(0, 10)
}

export function diffDays(fromISO: string, toISO: string): number {
  const from = new Date(`${fromISO}T00:00:00Z`).getTime()
  const to = new Date(`${toISO}T00:00:00Z`).getTime()
  return Math.round((to - from) / 86_400_000)
}

/**
 * 按「当前井盖类型 / 材质 / 安装日期 + 现行规则」判定状态。
 * 列表和详情共用这一份判定，保证两边结果一致。
 */
export function evaluateCover(row: EntryRow, todayISO: string): CoverEvaluation {
  const coverType = text(row.井盖类型)
  const material = text(row.井盖材质)
  const spec = text(row.规格尺寸)
  const installDate = text(row.安装日期)
  const requested = Boolean(row.requested)
  const phase = text(row.phase) || 'in_service'

  const missing: string[] = []
  if (!installDate) missing.push('安装日期缺失')
  if (!spec) missing.push('规格尺寸缺失')
  if (!coverType) missing.push('井盖类型缺失')
  if (!material) missing.push('井盖材质缺失')
  if (missing.length > 0) {
    return {
      status: '待补充',
      reasons: missing,
      ruleVersion: '',
      ruleLabel: '',
      ruleNote: '',
      cycleMonths: null,
      installDate,
      dueDate: null,
      abnormal: false,
    }
  }

  const version = currentRuleVersion(todayISO)
  const rule = findRule(version, coverType, material)
  if (!rule) {
    return {
      status: '异常',
      reasons: [`现行《${version.label}》中没有「井盖类型=${coverType}、井盖材质=${material}」对应的养护周期规则`],
      ruleVersion: version.version,
      ruleLabel: version.label,
      ruleNote: '',
      cycleMonths: null,
      installDate,
      dueDate: null,
      abnormal: true,
    }
  }

  if (installDate > todayISO) {
    return {
      status: '异常',
      reasons: [`安装日期 ${installDate} 晚于当前日期 ${todayISO}`],
      ruleVersion: version.version,
      ruleLabel: version.label,
      ruleNote: rule.note,
      cycleMonths: rule.cycleMonths,
      installDate,
      dueDate: null,
      abnormal: true,
    }
  }

  const dueDate = addMonths(installDate, rule.cycleMonths)
  const overdueDays = diffDays(dueDate, todayISO)

  // 人工阶段：只有维护中会中断自动判定；确认更换后阶段回到在册，按新井盖重新判定。
  if (phase === 'maintaining') {
    return {
      status: '维护中',
      reasons: [`井盖处于维护中；按 ${coverType}/${material} 周期 ${rule.cycleMonths} 个月，应办日期 ${dueDate}，完成更换后周期将重新起算`],
      ruleVersion: version.version,
      ruleLabel: version.label,
      ruleNote: rule.note,
      cycleMonths: rule.cycleMonths,
      installDate,
      dueDate,
      abnormal: false,
    }
  }

  if (overdueDays > 0) {
    return {
      status: '待维护',
      reasons: [`已超过养护应办日期 ${dueDate} ${overdueDays} 天（周期 ${rule.cycleMonths} 个月，依据《${version.label}》）`],
      ruleVersion: version.version,
      ruleLabel: version.label,
      ruleNote: rule.note,
      cycleMonths: rule.cycleMonths,
      installDate,
      dueDate,
      abnormal: false,
    }
  }
  if (overdueDays === 0) {
    return {
      status: '待维护',
      reasons: [`今天 ${todayISO} 已到养护应办日期 ${dueDate}，应安排维护（周期 ${rule.cycleMonths} 个月）`],
      ruleVersion: version.version,
      ruleLabel: version.label,
      ruleNote: rule.note,
      cycleMonths: rule.cycleMonths,
      installDate,
      dueDate,
      abnormal: false,
    }
  }

  const reasons = [`距养护应办日期 ${dueDate} 还有 ${-overdueDays} 天（周期 ${rule.cycleMonths} 个月，依据《${version.label}》）`]
  if (requested) {
    reasons.unshift('已人工申请维护，待开工')
  }
  return {
    status: requested ? '待维护' : '正常',
    reasons,
    ruleVersion: version.version,
    ruleLabel: version.label,
    ruleNote: rule.note,
    cycleMonths: rule.cycleMonths,
    installDate,
    dueDate,
    abnormal: false,
  }
}

/**
 * 针对某块井盖「从旧安装日期使用到更换日」做周期判定。
 * 用的是更换日当天生效的规则版本——这正是“历史按当时标准保留”的来源。
 */
export function evaluateClosedCycle(input: {
  coverType: string
  material: string
  spec: string
  startDate: string
  replacedAt: string
}): {
  conclusion: '正常' | '待维护' | '异常'
  reasons: string[]
  version: RuleVersion
  rule: CoverRule | null
  dueDate: string | null
} {
  const { coverType, material, spec, startDate, replacedAt } = input
  const missing: string[] = []
  if (!startDate) missing.push('安装日期缺失')
  if (!spec) missing.push('规格尺寸缺失')
  if (!coverType) missing.push('井盖类型缺失')
  if (!material) missing.push('井盖材质缺失')
  if (missing.length > 0) {
    return { conclusion: '异常', reasons: missing, version: ruleVersionAt(replacedAt), rule: null, dueDate: null }
  }

  const version = ruleVersionAt(replacedAt)
  const rule = findRule(version, coverType, material)
  if (!rule) {
    return {
      conclusion: '异常',
      reasons: [`更换时生效的《${version.label}》中没有「井盖类型=${coverType}、井盖材质=${material}」对应的养护周期规则`],
      version,
      rule: null,
      dueDate: null,
    }
  }
  if (startDate > replacedAt) {
    return {
      conclusion: '异常',
      reasons: [`安装日期 ${startDate} 晚于更换日期 ${replacedAt}`],
      version,
      rule,
      dueDate: null,
    }
  }

  const dueDate = addMonths(startDate, rule.cycleMonths)
  const daysUsed = diffDays(startDate, replacedAt)
  if (replacedAt > dueDate) {
    const overdue = diffDays(dueDate, replacedAt)
    return {
      conclusion: '待维护',
      reasons: [`更换时已超过当时应办日期 ${dueDate} ${overdue} 天（周期 ${rule.cycleMonths} 个月，依据《${version.label}》），实际使用 ${daysUsed} 天`],
      version,
      rule,
      dueDate,
    }
  }
  return {
    conclusion: '正常',
    reasons: [`更换日 ${replacedAt} 未超过当时应办日期 ${dueDate}（周期 ${rule.cycleMonths} 个月，依据《${version.label}》），实际使用 ${daysUsed} 天`],
    version,
    rule,
    dueDate,
  }
}
