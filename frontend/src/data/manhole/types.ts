/** 井盖养护域模型：规则版本、养护周期、维护履历都在这里定义。 */

/** 列表与详情共用的派生状态。 */
export type ManholeStatus =
  | '正常'
  | '待维护'
  | '维护中'
  | '已到期'
  | '待补充'
  | '异常'

/** 井盖当前所处的工作阶段，决定是否还允许状态流转。 */
export type WorkPhase = '正常' | '已申请' | '维护中'

/** 维护履历事件类型。 */
export type WorkEventType = '登记' | '申请维护' | '开始维护' | '更换' | '补充资料'

/** 某一类井盖（类型 + 材质）适用的养护规则。 */
export interface ManholeRule {
  coverType: string
  material: string
  /** 养护周期（天），从安装日期起算。 */
  cycleDays: number
  /** 到期前多少天进入「待维护」。 */
  warnDays: number
}

/** 规则版本：调整规则只生成新版本，历史版本永久保留，不影响当时的判定。 */
export interface ManholeRuleVersion {
  version: number
  effectiveDate: string
  createdAt: string
  note: string
  rules: ManholeRule[]
}

/** 一条养护周期记录：更换时旧记录关闭、按新井盖信息开新记录，绝不重复。 */
export interface CycleRecord {
  id: number
  coverId: number
  installDate: string
  coverType: string
  material: string
  spec: string
  /** 本条周期生效时适用的规则版本号。 */
  ruleVersion: number
  /** 规则快照：历史工作台始终按当时标准展示。 */
  rule: ManholeRule | null
  startDate: string
  dueDate: string
  /** 更换关闭旧周期时填写；进行中的周期为 null。 */
  endDate: string | null
  /** 哪次事件创建了本周期，用于幂等校验、防止重复确认。 */
  sourceEventId: number | null
}

/** 维护履历：历史维护工作台的数据来源，只追加、不改写。 */
export interface WorkEvent {
  id: number
  coverId: number
  coverNo: string
  type: WorkEventType
  date: string
  detail: string
  /** 当时适用的规则版本与描述，规则后续调整也不改变这里。 */
  ruleVersion: number | null
  ruleText: string
}

export interface ManholeCover {
  id: number
  coverNo: string
  road: string
  coverType: string
  material: string
  spec: string
  installDate: string
  phase: WorkPhase
  /** 更换次数。 */
  replaceCount: number
  /** 当前进行中的周期记录 id；资料待补充时为 null。 */
  activeCycleId: number | null
}

export type StatusReason =
  | 'in_progress'
  | 'requested'
  | 'missing_install_date'
  | 'missing_spec'
  | 'invalid_install_date'
  | 'rule_not_found'
  | 'overdue'
  | 'due_soon'
  | 'normal'

/** 统一的状态判定结果，列表、详情、待办筛选都用它，保证对得上。 */
export interface StatusEvaluation {
  status: ManholeStatus
  reason: StatusReason
  message: string
  cycleId: number | null
  cycleDays: number | null
  warnDays: number | null
  startDate: string | null
  dueDate: string | null
  daysToDue: number | null
  ruleVersion: number | null
  ruleText: string
}

export interface ManholeDataset {
  covers: ManholeCover[]
  cycles: CycleRecord[]
  events: WorkEvent[]
  ruleVersions: ManholeRuleVersion[]
}

export interface ServiceResult<T = unknown> {
  ok: boolean
  message: string
  data?: T
}

export interface ReplaceInput {
  coverType: string
  material: string
  spec: string
  installDate: string
}

export interface RuleVersionInput {
  effectiveDate: string
  note: string
  rules: ManholeRule[]
}
