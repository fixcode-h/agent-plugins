/** 配置的表头只套到结构对得上的表：辅助表、说明表不硬套 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TableSchema } from './tables.ts'
import { ruleOf } from './table-header.ts'
import { headerFit, pickHeader } from './table-header-fit.ts'
import { headerOf } from './table-struct.ts'

const schema = (extra: Record<string, unknown> = {}) =>
  TableSchema.parse({
    style: {
      header: {
        start: 0,
        rows: [
          { kind: 'modifier', values: 'Modifier' },
          { kind: 'side' },
          { kind: 'type', values: '@types' },
          { kind: 'name' },
          { kind: 'comment' },
        ],
      },
      primitives: ['int32', 'string', 'float'],
      ...extra,
    },
    enums: {
      Modifier: { values: [{ name: 'optional' }, { name: 'repeated' }] },
      EColor: { values: [{ name: 'Red' }] },
    },
    types: { FVector: { kind: 'struct', fields: [{ name: 'X', type: 'float' }] } },
  })

/** 正经的配置表：修饰 / 导出端 / 类型 / 字段名 / 注释，后面是数据 */
const config = [
  ['', 'repeated', '', ''],
  ['Client|Server', 'Client', 'Server', 'C'],
  ['int32', 'int32', 'EColor', 'FVector'],
  ['ID', 'Rewards', 'Color', 'Pos'],
  ['编号', '奖励', '颜色', '位置'],
  ['1001', '1;2', 'Red', '1#2#3'],
]
/** 辅助表：第一行就是中文列名，下面是说明 */
const helper = [
  ['名称', '说明', '负责人'],
  ['掉落', '掉落表的填法', '张三'],
  ['技能', '技能表的填法', '李四'],
  ['任务', '任务表的填法', '王五'],
  ['商店', '', '赵六'],
  ['活动', '活动表的填法', '钱七'],
]

test('结构对得上的表套项目表头，辅助表不套', () => {
  const s = schema()
  assert.deepEqual(headerFit(s, s.style.header, config), { ok: true })
  assert.equal(pickHeader(s, 'Config/Item.xlsx', 'Sheet1', config).source.kind, 'project')
  assert.equal(headerOf(s, 'Config/Item.xlsx', { name: 'Sheet1', rows: config }).roles.length, 5)

  // 第 1 行（修饰）就对不上：不套，整张表按数据
  assert.deepEqual(headerFit(s, s.style.header, helper), { ok: false, row: 0 })
  const picked = pickHeader(s, 'Config/说明.xlsx', 'Sheet1', helper)
  assert.equal(picked.source.kind, 'unfit')
  assert.deepEqual(picked.rule.rows, [])
  assert.deepEqual(headerOf(s, 'Config/说明.xlsx', { name: 'Sheet1', rows: helper }).roles, [])
})

test('每一行按自己该有的样子比：类型认不出、字段名重复或是数字、表比表头短都算对不上', () => {
  const s = schema()
  const badType = config.map((r, i) => (i === 2 ? ['abc', 'def', 'ghi', 'jkl'] : r))
  assert.deepEqual(headerFit(s, s.style.header, badType), { ok: false, row: 2 })
  const dupName = config.map((r, i) => (i === 3 ? ['ID', 'ID', 'ID', 'Pos'] : r))
  assert.deepEqual(headerFit(s, s.style.header, dupName), { ok: false, row: 3 })
  const numName = config.map((r, i) => (i === 3 ? ['1', '2', '3', 'Pos'] : r))
  assert.deepEqual(headerFit(s, s.style.header, numName), { ok: false, row: 3 })
  assert.equal(headerFit(s, s.style.header, config.slice(0, 3)).ok, false)
  // 修饰、导出端整行空着（这张表正好没有数组列）不算对不上；新建的空表也照套
  const noMods = config.map((r, i) => (i === 0 ? ['', '', '', ''] : r))
  assert.equal(headerFit(s, s.style.header, noMods).ok, true)
  assert.equal(headerFit(s, s.style.header, []).ok, true)
  // 少数几格不合（80% 以上合就算）：没登记的大驼峰类型名也认
  const oneOff = config.map((r, i) => (i === 2 ? ['int32', 'int32', 'EColor', 'FNewThing'] : r))
  assert.equal(headerFit(s, s.style.header, oneOff).ok, true)
})

test('按通配的按文件指定也要对得上，不然往下找；只管这个工作表的那条照用不比', () => {
  const two = ruleOf(['name', 'comment'])
  const s = schema({
    exceptions: [
      { glob: 'Config/Help.xlsx', sheet: 'Sheet1', header: ruleOf(['modifier', 'side', 'type', 'name']) },
      { glob: 'Config/Enum/*.xlsx', header: two },
    ],
  })
  // 点名的那条：结构对不上也照用（用户说了算）
  assert.equal(pickHeader(s, 'Config/Help.xlsx', 'Sheet1', helper).source.kind, 'sheet')
  const enumSheet = [
    ['Name', 'Value'],
    ['名字', '值'],
    ['Red', '1'],
  ]
  assert.deepEqual(pickHeader(s, 'Config/Enum/Color.xlsx', 'Sheet1', enumSheet).source, { kind: 'file', index: 1 })
  // 通配命中但对不上，项目表头对得上：用项目表头
  assert.equal(pickHeader(s, 'Config/Enum/Item.xlsx', 'Sheet1', config).source.kind, 'project')
  // 都对不上：不套，记下本来要用的是那条按文件指定
  const none = pickHeader(s, 'Config/Enum/Bad.xlsx', 'Sheet1', [
    ['1', '2'],
    ['3', '4'],
  ])
  assert.equal(none.source.kind, 'unfit')
  assert.deepEqual(none.source.kind === 'unfit' && none.source.from, { kind: 'file', index: 1 })
  // 不给内容（还没读到）：和以前一样按优先级取
  assert.equal(pickHeader(s, 'Config/说明.xlsx', 'Sheet1').source.kind, 'project')
})
