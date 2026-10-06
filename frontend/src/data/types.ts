/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

// 井盖周期记录：确认更换时按当时标准冻结，之后调整规则不会改写它。
export type ManholeCycleRecord = {
  id: number
  manholeId: number
  manholeCode: string
  coverType: string
  material: string
  spec: string
  startDate: string
  replacedAt: string
  daysUsed: number
  cycleMonths: number | null
  ruleVersion: string
  ruleLabel: string
  dueDate: string | null
  conclusion: '正常' | '待维护' | '异常'
  reasons: string[]
}

export type FieldValue = string | number | boolean | number[]

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: FieldValue
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
