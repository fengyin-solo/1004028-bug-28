import {
  V1_RULE_VERSION,
  addDaysISO,
  describeRule,
  evaluateCover,
  findRule,
  isValidISODate,
  todayISO,
} from './rules'
import type {
  CycleRecord,
  ManholeCover,
  ManholeDataset,
  ManholeRuleVersion,
  WorkEvent,
} from './types'

/**
 * 示例数据覆盖所有关键场景：
 * 0001 正常；0002 超期（旧逻辑容易误判为正常）；0003 临期待维护；
 * 0004 规则库无此类型材质（异常并说明原因）；0005 缺安装日期、0006 缺规格（待补充）；
 * 0007 更换过井盖（旧周期已关闭、新周期独立计算，当前维护中）；0008 已申请维护。
 */
export function buildSeedDataset(onDate: string = todayISO()): ManholeDataset {
  const ruleVersions: ManholeRuleVersion[] = [V1_RULE_VERSION]
  const offset = (days: number) => addDaysISO(onDate, days)
  const v1Rule = (coverType: string, material: string) =>
    findRule(V1_RULE_VERSION.rules, coverType, material)

  const covers: ManholeCover[] = []
  const cycles: CycleRecord[] = []
  const events: WorkEvent[] = []
  let cycleSeq = 0
  let eventSeq = 0

  function addEvent(
    coverId: number,
    coverNo: string,
    type: WorkEvent['type'],
    date: string,
    detail: string,
    ruleVersion: number | null,
    ruleText: string,
  ): void {
    eventSeq += 1
    events.push({ id: eventSeq, coverId, coverNo, type, date, detail, ruleVersion, ruleText })
  }

  function startCycle(
    cover: ManholeCover,
    installDate: string,
    sourceEventId: number | null,
  ): CycleRecord | null {
    const rule = v1Rule(cover.coverType, cover.material)
    if (!rule || !isValidISODate(installDate) || !cover.spec.trim()) {
      return null
    }
    cycleSeq += 1
    const record: CycleRecord = {
      id: cycleSeq,
      coverId: cover.id,
      installDate,
      coverType: cover.coverType,
      material: cover.material,
      spec: cover.spec,
      ruleVersion: V1_RULE_VERSION.version,
      rule: { ...rule },
      startDate: installDate,
      dueDate: addDaysISO(installDate, rule.cycleDays),
      endDate: null,
      sourceEventId,
    }
    cycles.push(record)
    cover.activeCycleId = record.id
    return record
  }

  function register(
    id: number,
    coverNo: string,
    road: string,
    coverType: string,
    material: string,
    spec: string,
    installDate: string,
    phase: ManholeCover['phase'] = '正常',
    replaceCount = 0,
    options: { autoCycle?: boolean } = {},
  ): ManholeCover {
    const { autoCycle = true } = options
    const cover: ManholeCover = {
      id,
      coverNo,
      road,
      coverType,
      material,
      spec,
      installDate,
      phase,
      replaceCount,
      activeCycleId: null,
    }
    covers.push(cover)
    if (autoCycle && isValidISODate(installDate)) {
      const rule = v1Rule(cover.coverType, cover.material)
      const cycle = startCycle(cover, installDate, null)
      const reason = !rule
        ? '规则库无此类型/材质的养护标准，未生成养护周期'
        : !cover.spec.trim()
          ? '规格尺寸缺失，未生成养护周期'
          : '资料不全，未生成养护周期'
      addEvent(
        id,
        coverNo,
        '登记',
        installDate,
        `登记安装：${coverType}/${material}，规格 ${spec || '未填写'}，安装日期 ${installDate}`,
        cycle ? V1_RULE_VERSION.version : null,
        cycle ? describeRule(cycle.rule) : reason,
      )
    } else if (autoCycle) {
      addEvent(
        id,
        coverNo,
        '登记',
        onDate,
        `登记安装：${coverType}/${material}，安装日期缺失，资料待补充`,
        null,
        '缺少安装日期，无法确定适用规则',
      )
    }
    return cover
  }

  // 1) 正常：球墨铸铁雨水井，周期 180 天，安装 40 天，距到期 140 天。
  register(1, 'MANH-0001', '解放大路', '雨水检查井', '球墨铸铁', 'Φ700', offset(-40))

  // 2) 已到期：复合材料污水井周期 90 天，已装 100 天，超期 10 天。
  register(2, 'MANH-0002', '人民大街', '污水检查井', '复合材料', '600×600', offset(-100))

  // 3) 临期待维护：球墨铸铁雨水井，安装 160 天，距到期 20 天（预警窗口 30 天）。
  register(3, 'MANH-0003', '建设街', '雨水检查井', '球墨铸铁', 'Φ700', offset(-160))

  // 4) 规则库未收录热力井：安装日期、规格齐全但算不出周期，判为异常并说明。
  register(4, 'MANH-0004', '供暖支路', '热力检查井', '球墨铸铁', 'Φ800', offset(-50))

  // 5) 缺少安装日期：进入待补充，而不是直接正常。
  register(5, 'MANH-0005', '滨河路', '电力检查井', '复合材料', '700×700', '')

  // 6) 缺少规格尺寸：同样进入待补充。
  register(6, 'MANH-0006', '南湖大路', '雨水检查井', '复合材料', '', offset(-30))

  // 7) 更换场景：旧的燃气井 200 天前登记安装，30 天前申请、28 天前开工、
  //    25 天前确认更换为球墨铸铁污水井；旧周期关闭，新周期按新类型/材质/安装日重算。
  //    按真实时间顺序手工构造，周期/事件 id 与发生顺序一致。
  const c7 = register(
    7,
    'MANH-0007',
    '东风大街',
    '燃气检查井',
    '球墨铸铁',
    'Φ700',
    offset(-200),
    '正常',
    0,
    { autoCycle: false },
  )
  const oldRule7 = v1Rule('燃气检查井', '球墨铸铁')!
  cycleSeq += 1
  cycles.push({
    id: cycleSeq,
    coverId: 7,
    installDate: offset(-200),
    coverType: '燃气检查井',
    material: '球墨铸铁',
    spec: 'Φ700',
    ruleVersion: 1,
    rule: { ...oldRule7 },
    startDate: offset(-200),
    dueDate: addDaysISO(offset(-200), oldRule7.cycleDays),
    endDate: null,
    sourceEventId: null,
  })
  c7.activeCycleId = cycleSeq
  addEvent(7, 'MANH-0007', '登记', offset(-200), '登记安装：燃气检查井/球墨铸铁（Φ700）', 1, describeRule(oldRule7))
  addEvent(7, 'MANH-0007', '申请维护', offset(-30), '按燃气井养护周期到期申请维护', 1, describeRule(oldRule7))
  c7.phase = '已申请'
  addEvent(7, 'MANH-0007', '开始维护', offset(-28), '维护人员开工', 1, describeRule(oldRule7))
  c7.phase = '维护中'
  // 确认更换：关闭旧周期，按新井盖开新周期。
  const oldCycle7 = cycles[cycles.length - 1]
  oldCycle7.endDate = offset(-25)
  const newRule7 = v1Rule('污水检查井', '球墨铸铁')!
  eventSeq += 1
  const replaceEventId = eventSeq
  events.push({
    id: replaceEventId,
    coverId: 7,
    coverNo: 'MANH-0007',
    type: '更换',
    date: offset(-25),
    detail:
      '确认更换：燃气检查井/球墨铸铁（Φ700） → 污水检查井/球墨铸铁（Φ700），新安装日期 ' +
      offset(-25) + '；旧周期关闭，新周期按新井盖重新计算',
    ruleVersion: 1,
    ruleText: describeRule(newRule7),
  })
  cycleSeq += 1
  cycles.push({
    id: cycleSeq,
    coverId: 7,
    installDate: offset(-25),
    coverType: '污水检查井',
    material: '球墨铸铁',
    spec: 'Φ700',
    ruleVersion: 1,
    rule: { ...newRule7 },
    startDate: offset(-25),
    dueDate: addDaysISO(offset(-25), newRule7.cycleDays),
    endDate: null,
    sourceEventId: replaceEventId,
  })
  c7.coverType = '污水检查井'
  c7.installDate = offset(-25)
  c7.replaceCount = 1
  c7.activeCycleId = cycleSeq

  // 8) 已申请维护：列表与详情都应显示待维护（已申请）。
  register(8, 'MANH-0008', '西安大路', '污水检查井', '球墨铸铁', 'Φ700', offset(-70), '已申请')
  addEvent(8, 'MANH-0008', '申请维护', offset(-2), '申请安排养护', 1, describeRule(v1Rule('污水检查井', '球墨铸铁')))

  const dataset: ManholeDataset = { covers, cycles, events, ruleVersions }
  assertSeed(dataset, onDate)
  return dataset
}

/** 种子自检：保证示例数据本身就能暴露/验证关键规则，列表与详情共用同一判定。 */
function assertSeed(dataset: ManholeDataset, onDate: string): void {
  const byNo = new Map(dataset.covers.map((c) => [c.coverNo, c]))
  const check = (label: string, pass: boolean): void => {
    if (!pass) {
      throw new Error(`井盖示例数据自检失败：${label}`)
    }
  }
  const ev = (no: string) => evaluateCover(byNo.get(no)!, dataset.cycles, onDate, dataset.ruleVersions)

  check('MANH-0001 应为正常', ev('MANH-0001').status === '正常')
  check('MANH-0002 超期应显示已到期而不是正常', ev('MANH-0002').status === '已到期')
  check('MANH-0003 临期应进入待维护', ev('MANH-0003').status === '待维护')
  check('MANH-0003 距到期应为 20 天', ev('MANH-0003').daysToDue === 20)
  check('MANH-0003 周期应按 180 天计算，到期日为安装日后 180 天',
    ev('MANH-0003').cycleDays === 180 &&
      ev('MANH-0003').dueDate === addDaysISO(byNo.get('MANH-0003')!.installDate, 180))
  check('MANH-0004 无适用规则应判异常并说明', ev('MANH-0004').status === '异常' && ev('MANH-0004').reason === 'rule_not_found')
  check('MANH-0005 缺安装日期应待补充', ev('MANH-0005').status === '待补充' && ev('MANH-0005').reason === 'missing_install_date')
  check('MANH-0006 缺规格应待补充', ev('MANH-0006').status === '待补充' && ev('MANH-0006').reason === 'missing_spec')
  check('MANH-0007 维护中', ev('MANH-0007').status === '维护中')
  const c7Cycles = dataset.cycles.filter((c) => c.coverId === 7)
  check('MANH-0007 应有新旧两条周期且仅一条进行中', c7Cycles.length === 2 && c7Cycles.filter((c) => c.endDate === null).length === 1)
  check('MANH-0007 新周期应为 180 天', c7Cycles.find((c) => c.endDate === null)?.rule?.cycleDays === 180)
  check('MANH-0008 已申请应为待维护', ev('MANH-0008').status === '待维护' && ev('MANH-0008').reason === 'requested')
}
