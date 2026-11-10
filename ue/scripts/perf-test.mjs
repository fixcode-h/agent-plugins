// CSV 和 memreport 解析器的测试：直接跑源码（Node 22 能直接执行 .ts），不需要 UE，也不需要先构建。
// 用法：node ue/scripts/perf-test.mjs
import assert from 'node:assert/strict'
import { csvCompare, csvQuery, csvSummary, parseCsv, splitCsvLine } from '../server/perf/csv.ts'
import { memCompare, memQuery, memSummary, parseMemReport } from '../server/perf/memreport.ts'
import { makeCsv, makeMemReport } from './perf-fixtures.mjs'

// ---------- CSV ----------
assert.deepEqual(splitCsvLine('a,"b, c",d'), ['a', 'b, c', 'd'])
const csv = parseCsv(makeCsv())
assert.equal(csv.frames, 600, '末尾重复的列名行和元数据行不能算成帧')
assert.equal(csv.meta.Platform, 'Windows')
assert.equal(csv.meta.Commandline, '-game -log, -windowed', '带引号的元数据里有逗号')
assert.equal(csv.events.length, 2)
assert.ok(csv.seconds > 9 && csv.seconds < 11, `600 帧 60fps 大约 10 秒，算出来 ${csv.seconds}`)

const sum = csvSummary(csv)
assert.equal(sum.hitches.count, 3)
assert.equal(sum.hitches.worst[0].frame, 200)
assert.ok(sum.fps.avg > 55 && sum.fps.avg < 61)
assert.ok(sum.key.GameThreadTime && sum.key['RHI/DrawCalls'], '关键列里要有线程时间和绘制调用')
assert.equal(sum.meta.Config, 'Development')

const hit = csvQuery(csv, { what: 'hitches' })
assert.equal(hit.count, 3)
const spikeNames = hit.worst[0].spikes.map((s) => s.column)
assert.ok(spikeNames.includes('GameThreadTime') && spikeNames.includes('Slate/Tick'), `卡顿帧要指出涨的列：${spikeNames}`)
assert.ok(!spikeNames.includes('RHI/DrawCalls'), '没涨的列不能混进来')
// 限定时间段：只看 5 秒之后，只剩第 450 帧那一次
assert.equal(csvQuery(csv, { what: 'hitches', from: 5 }).count, 1)

const col = csvQuery(csv, { what: 'column', name: 'slate/tick', top: 20 })
assert.equal(col.column, 'Slate/Tick')
assert.ok(col.series.length <= 20 && col.stat.max === 55)
assert.throws(() => csvQuery(csv, { what: 'column', name: 'nope' }), /没有「nope」这一列/)
assert.equal(csvQuery(csv, { what: 'columns', name: 'rhi' }).total, 3, 'RHI/ 两列加 RHIThreadTime')

const frame = csvQuery(csv, { what: 'frame', frame: 200 })
assert.equal(frame.key.GameThreadTime, 70)
const seg = csvQuery(csv, { what: 'segment' })
assert.deepEqual(
  seg.segments.map((s) => [s.from, s.frames]),
  [
    ['(开头)', 100],
    ['open_bag', 200],
    ['close_bag', 300],
  ],
)
assert.ok(seg.segments[1].stats.FrameTime.max > 70, '卡顿帧在 open_bag 到 close_bag 这一段里')

const cmp = csvCompare(csv, parseCsv(makeCsv({ hitchAt: [], slow: 20 })))
assert.equal(cmp.hitches.a, 3)
assert.equal(cmp.hitches.b, 0)
const gt = cmp.key.find((r) => r.column === 'GameThreadTime')
assert.ok(gt.delta > 19 && gt.delta < 21, `游戏线程平均慢了约 20 毫秒：${gt.delta}`)

assert.throws(() => parseCsv('1,2,3\n4,5,6'), /第一行应该是列名/)

// ---------- memreport ----------
const mem = parseMemReport(makeMemReport())
assert.deepEqual(
  mem.sections.map((s) => s.command),
  ['(header)', 'obj list -alphasort', 'ListTextures -alphasort', 'rhi.DumpMemory'],
)
const ms = memSummary(mem)
assert.ok(ms.header.some((l) => l.includes('Process Physical Memory')))
assert.equal(ms.objects.rows[0][0], 'Texture2D', '默认按资源大小排，贴图最大')
assert.equal(ms.objects.sortedBy, 'ResExcKB')

const byCount = memQuery(mem, { what: 'objects', sort: 'Count', top: 2 })
assert.equal(byCount.rows[0][0], 'Function')
assert.equal(byCount.total, 7)
assert.ok(byCount.totalLine.includes('Objects (Total'))
assert.equal(memQuery(mem, { what: 'objects', name: 'mesh' }).total, 2)

const tex = memQuery(mem, { what: 'textures' })
assert.equal(tex.total, 3)
assert.ok(tex.columns.includes('Name') && tex.rows.some((r) => r.includes('/Game/UI/T_BagBg.T_BagBg')))
const rhi = memQuery(mem, { what: 'rhi' })
assert.ok(rhi.lines.some((l) => l.includes('Texture Memory 2D')), '认不出表的段按原文给')
assert.equal(memQuery(mem, { what: 'section', name: 'rhi', contains: 'vertex' }).total, 1)
assert.throws(() => memQuery(mem, { what: 'sounds' }), /没有 sounds 对应的段/)

const diff = memCompare(mem, parseMemReport(makeMemReport({ extra: { WBP_Bag_C: 40, Texture2D: 12 } })))
assert.equal(diff.byCount[0].class, 'WBP_Bag_C')
assert.equal(diff.byCount[0].countDelta, 40)
assert.equal(diff.totals.countDelta, 52)
assert.equal(diff.shrunk.length, 0)

assert.throws(() => parseMemReport('hello world'), /不像 memreport/)

console.log('性能解析器测试通过：CSV 和 memreport')
