// 井盖养护域端到端行为验证：用 esbuild 即时转译 TS，mock localStorage 后在 Node 中跑。
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

const harness = String.raw`
// ---- mock 浏览器持久层 ----
const memory = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => { memory.set(k, String(v)) },
    removeItem: (k) => { memory.delete(k) },
  },
}
globalThis.localStorage = globalThis.window.localStorage

import { manholeDataset } from '@/data/manhole/store'
import {
  listCovers, getCover, requestMaintenance, startMaintenance,
  confirmReplacement, supplementInfo, saveRuleVersion, listWorkEvents,
  manholeOverview, resetManhole,
} from '@/api/manhole-service'
import { evaluateCover, addDaysISO, todayISO } from '@/data/manhole/rules'

let pass = 0, fail = 0
function check(label, cond) {
  if (cond) { pass++; console.log('  ✓', label) }
  else { fail++; console.log('  ✗', label) }
}
function byNo(no) {
  const ds = manholeDataset()
  const cover = ds.covers.find(c => c.coverNo === no)
  return { ds, cover, ev: evaluateCover(cover, ds.cycles, today, ds.ruleVersions) }
}
const today = todayISO()

console.log('1) 列表/详情一致性 + 种子场景')
for (const row of listCovers().items) {
  const detail = getCover(row.cover.id)
  check(row.cover.coverNo + ' 列表与详情状态一致', detail.evaluation.status === row.evaluation.status)
  check(row.cover.coverNo + ' 列表与详情到期日一致', detail.evaluation.dueDate === row.evaluation.dueDate)
  check(row.cover.coverNo + ' 列表与详情说明一致', detail.evaluation.message === row.evaluation.message)
}
check('0001 正常', byNo('MANH-0001').ev.status === '正常')
check('0002 超期显示已到期而非正常', byNo('MANH-0002').ev.status === '已到期')
check('0002 异常说明包含具体条件（超期天数与到期日）', /超过养护周期 10 天/.test(byNo('MANH-0002').ev.message) && byNo('MANH-0002').ev.dueDate != null)
check('0003 符合临期条件进入待维护', byNo('MANH-0003').ev.status === '待维护')
check('0004 无规则判异常', byNo('MANH-0004').ev.status === '异常')
check('0004 异常说明指出缺失的具体规则项', /热力检查井\/球墨铸铁/.test(byNo('MANH-0004').ev.message) && /养护标准/.test(byNo('MANH-0004').ev.message))
check('0005 缺安装日期 -> 待补充', byNo('MANH-0005').ev.reason === 'missing_install_date')
check('0006 缺规格 -> 待补充', byNo('MANH-0006').ev.reason === 'missing_spec')
check('0007 维护中', byNo('MANH-0007').ev.status === '维护中')
check('0007 旧周期已关闭、仅一条进行中',
  (() => { const cs = manholeDataset().cycles.filter(c => c.coverId === 7); return cs.length === 2 && cs.filter(c => c.endDate === null).length === 1 })())
check('0008 已申请 -> 待维护且原因说明', byNo('MANH-0008').ev.status === '待维护' && byNo('MANH-0008').ev.reason === 'requested')

console.log('2) 确认更换：按新类型/材质/安装日期重算')
let r = confirmReplacement(7, { coverType: '电力检查井', material: '复合材料', spec: '700×700', installDate: today })
check('更换成功', r.ok)
const newCycle = manholeDataset().cycles.filter(c => c.coverId === 7 && c.endDate === null)
check('新周期唯一', newCycle.length === 1)
check('新周期类型为电力检查井/复合材料', newCycle[0].coverType === '电力检查井' && newCycle[0].material === '复合材料')
check('新周期按 180 天重算（不是旧燃气井 90 天）', newCycle[0].rule.cycleDays === 180)
check('新到期日 = 安装日 + 180', newCycle[0].dueDate === addDaysISO(today, 180))
check('更换后重判为正常', byNo('MANH-0007').ev.status === '正常')
const listRow = listCovers().items.find(x => x.cover.coverNo === 'MANH-0007')
check('更换后列表与详情状态一致', getCover(7).evaluation.status === listRow.evaluation.status)
check('更换次数在种子 1 次基础上累加为 2', byNo('MANH-0007').cover.replaceCount === 2)
check('本次被关闭的周期关闭日期 = 新安装日期', manholeDataset().cycles.filter(c => c.coverId === 7 && c.endDate === today).length === 1)

console.log('3) 重复确认不产生多余周期记录')
const c0 = manholeDataset().cycles.length, e0 = manholeDataset().events.length
r = confirmReplacement(7, { coverType: '雨水检查井', material: '球墨铸铁', spec: 'Φ700', installDate: today })
check('非维护中重复确认被拒绝', !r.ok)
check('周期记录数量不变', manholeDataset().cycles.length === c0)
check('履历记录数量不变', manholeDataset().events.length === e0)
r = requestMaintenance(7); check('正常态可以申请维护', r.ok)
r = requestMaintenance(7); check('重复申请被拒绝', !r.ok)
r = startMaintenance(7); check('开工成功', r.ok)
r = startMaintenance(7); check('重复开工被拒绝', !r.ok)
const c1 = manholeDataset().cycles.length, e1 = manholeDataset().events.length
r = confirmReplacement(7, { coverType: '雨水检查井', material: '球墨铸铁', spec: 'Φ700', installDate: today })
check('第二次更换成功', r.ok)
check('每次更换只新增 1 条周期', manholeDataset().cycles.length === c1 + 1)
check('每次更换只新增 1 条履历', manholeDataset().events.length === e1 + 1)
check('仍只有一条进行中周期', manholeDataset().cycles.filter(c => c.coverId === 7 && c.endDate === null).length === 1)

console.log('4) 缺少资料：补充后建周期，且不能重复建')
r = supplementInfo(5, { installDate: '', spec: '700×700' })
check('缺安装日期被拒绝', !r.ok)
r = supplementInfo(5, { installDate: addDaysISO(today, 3), spec: '700×700' })
check('未来安装日期被拒绝', !r.ok)
r = supplementInfo(5, { installDate: today, spec: '700×700' })
check('补充成功', r.ok)
check('补充后状态正常（电力/复合材料 180 天）', byNo('MANH-0005').ev.status === '正常')
check('补充后存在唯一进行中周期', manholeDataset().cycles.filter(c => c.coverId === 5 && c.endDate === null).length === 1)
const c5 = manholeDataset().cycles.length
r = supplementInfo(5, { installDate: today, spec: '700×700' })
check('资料齐全后再次补充被拒绝，不重复建周期', !r.ok && manholeDataset().cycles.length === c5)
r = supplementInfo(6, { installDate: byNo('MANH-0006').cover.installDate, spec: '600×600' })
check('0006 补规格成功', r.ok)
check('0006 补后按雨水/复合材料 120 天计算', byNo('MANH-0006').ev.cycleDays === 120)

console.log('5) 规则调整只影响之后判定，历史工作台保留当时标准')
r = saveRuleVersion({ effectiveDate: addDaysISO(today, -1), note: '追溯修改', rules: [] })
check('生效日早于今天被拒绝', !r.ok)
// V2 今天生效：此前起算的周期仍按 V1，发布之后的更换才按 V2。
const future = today
{
  const rules = manholeDataset().ruleVersions.find(v => v.version === 1).rules.map(x => ({ ...x }))
  const t = rules.find(x => x.coverType === '雨水检查井' && x.material === '球墨铸铁')
  t.cycleDays = 60; t.warnDays = 10
  r = saveRuleVersion({ effectiveDate: future, note: '球墨铸铁雨水井周期缩短为 60 天', rules })
}
check('V2 发布成功（今天生效，仅影响之后判定）', r.ok)
check('既有周期仍按 V1 180 天判定', byNo('MANH-0001').ev.ruleVersion === 1 && byNo('MANH-0001').ev.cycleDays === 180)
check('0001 当前仍正常（不受新规影响）', byNo('MANH-0001').ev.status === '正常')
requestMaintenance(1)
startMaintenance(1)
r = confirmReplacement(1, { coverType: '雨水检查井', material: '球墨铸铁', spec: 'Φ700', installDate: future })
check('发布之后的更换按 V2 60 天重算', r.ok && byNo('MANH-0001').ev.cycleDays === 60 && byNo('MANH-0001').ev.ruleVersion === 2)
const wb = listWorkEvents()
const oldReg = wb.filter(e => e.coverNo === 'MANH-0001' && e.type === '登记')[0]
check('历史登记履历仍保留 V1 规则描述', oldReg.ruleVersion === 1 && /180 天/.test(oldReg.ruleText))
const replEvent = wb.find(e => e.coverNo === 'MANH-0001' && e.type === '更换')
check('更换履历记录 V2 规则', replEvent.ruleVersion === 2 && /60 天/.test(replEvent.ruleText))
check('V1 版本仍可查且规则未被修改', manholeDataset().ruleVersions.find(v => v.version === 1).rules.find(x => x.coverType === '雨水检查井' && x.material === '球墨铸铁').cycleDays === 180)

console.log('6) 更换/申请表单校验：缺字段、无规则组合、异常态拦截')
resetManhole()
check('待补充井盖不能申请维护', !requestMaintenance(5).ok)
check('异常井盖（无规则）不能申请维护', !requestMaintenance(4).ok)
const cBefore = manholeDataset().cycles.length
const eBefore = manholeDataset().events.length
r = confirmReplacement(7, { coverType: '热力检查井', material: '球墨铸铁', spec: 'Φ800', installDate: today })
check('更换为规则库不存在的组合被拒绝并指明原因', !r.ok && /热力检查井/.test(r.message))
r = confirmReplacement(7, { coverType: '污水检查井', material: '球墨铸铁', spec: '', installDate: today })
check('更换缺规格被拒绝', !r.ok)
r = confirmReplacement(7, { coverType: '污水检查井', material: '球墨铸铁', spec: 'Φ700', installDate: 'bad' })
check('更换日期格式错误被拒绝', !r.ok)
r = confirmReplacement(7, { coverType: '污水检查井', material: '球墨铸铁', spec: 'Φ700', installDate: addDaysISO(today, 1) })
check('更换安装日期晚于今天被拒绝', !r.ok)
check('校验失败不产生任何周期/履历增量', manholeDataset().cycles.length === cBefore && manholeDataset().events.length === eBefore)

console.log('7) 概览口径与列表一致')
const ov = manholeOverview()
const statusCount = s => listCovers().items.filter(x => x.evaluation.status === s).length
check('概览待维护+已到期数量正确', ov.pending === statusCount('待维护') + statusCount('已到期'))
check('概览异常数量正确', ov.abnormal === statusCount('异常'))
check('概览待补充数量正确', ov.needInfo === statusCount('待补充'))
check('概览更换过的井盖数量正确', ov.replaced === 1)

console.log('\\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (fail > 0) process.exit(1)
`

const dir = mkdtempSync(join(tmpdir(), 'manhole-test-'))
const entry = join(dir, 'harness.ts')
writeFileSync(entry, harness)

const result = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  alias: { '@': join(process.cwd(), 'src') },
})

const outFile = join(dir, 'harness.mjs')
writeFileSync(outFile, result.outputFiles[0].text)
await import(outFile)
