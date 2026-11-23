import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { PluginServerContext } from '../../../../../sdk/server.ts'
import type { GtClassRow } from '../../../../shared/gt-script/ref/types.ts'
import type { UeProject } from '../../../types.ts'
import { setCtx } from '../../../util.ts'
import { classIndex, mergeRows, type ClassIndexDeps } from './index.ts'

let dataDir = ''
before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'ue-class-index-'))
  setCtx({
    dataDir,
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (m, k: string) => (vars && k in vars ? String(vars[k]) : m)),
    log: { info: () => undefined, warn: () => undefined },
  } as unknown as PluginServerContext)
})

const ROWS: GtClassRow[] = [
  ['Object', '', 'object', '', 0],
  ['Actor', 'Object', 'actor', '', 0],
  ['BP_Hero', 'Actor', 'actor', '/Game/BP_Hero', 2],
]

test('UObject：UE 给了整表就用它，旧 GameTest 回的没有 rows 时用磁盘并提示升级', () => {
  assert.equal(mergeRows(false, { rows: ROWS }, '', undefined).source, 'ue')
  const old = mergeRows(false, { items: [] }, '', ROWS)
  assert.equal(old.source, 'disk')
  assert.match(old.note ?? '', /2\.4\.0/)
  assert.match(mergeRows(false, undefined, '连不上', ROWS).note ?? '', /连不上/)
})

test('Lua：以磁盘为准，UE 只补此刻实例数（模块名 / 和 . 不敏感）', () => {
  const disk: GtClassRow[] = [
    ['UI/Shop', '', 'lua', 'Content/Script/UI/Shop.lua', 0],
    ['UI/Bag', '', 'lua', 'Content/Script/UI/Bag.lua', 0],
  ]
  const r = mergeRows(true, { rows: [['ui.shop', '', 'lua', '', 3]] }, '', disk)
  assert.deepEqual(
    r.rows.map((x) => x[4]),
    [3, 0],
  )
})

function deps(calls: string[], rows: () => GtClassRow[]): ClassIndexDeps {
  return {
    live: async (_lua, fresh) => {
      calls.push(fresh ? 'live-fresh' : 'live')
      return { rows: rows() }
    },
    disk: async () => {
      calls.push('disk')
      return []
    },
  }
}

test('第一次等建好；之后马上回记住的、带 v 没变回 same；存进数据目录，重启后先给存的那份', async () => {
  const p = { id: 'p1', root: '/x' } as UeProject
  const calls: string[] = []
  let rows = ROWS
  const d = deps(calls, () => rows)
  const a = await classIndex(p, {}, d)
  assert.equal(a.rows?.length, 3)
  assert.deepEqual(calls, ['live'])
  // 刚建过：不重建，带 v 回 same、不带 rows
  const b = await classIndex(p, { v: a.v }, d)
  assert.equal(b.same, true)
  assert.equal(b.rows, undefined)
  assert.deepEqual(calls, ['live'])
  // 存盘的那份 at 记 0
  await new Promise((r) => setTimeout(r, 50))
  const saved = JSON.parse(await readFile(path.join(dataDir, 'class-index', 'p1-ue.json'), 'utf8'))
  assert.equal(saved.v, a.v)
  assert.equal(saved.at, 0)
  // 刷新：强制重建，内容变了换 v
  rows = [...ROWS, ['BP_Enemy', 'Actor', 'actor', '/Game/BP_Enemy', 0]]
  const c = await classIndex(p, { fresh: true, v: a.v }, d)
  assert.deepEqual(calls, ['live', 'live-fresh'])
  assert.notEqual(c.v, a.v)
  assert.equal(c.rows?.length, 4)
})

test('从数据目录读回来的算旧的：马上回它、标 refreshing，带 wait 再问拿重建后的', async () => {
  const p = { id: 'p2', root: '/y' } as UeProject
  const calls: string[] = []
  await classIndex(
    p,
    {},
    deps(calls, () => ROWS),
  )
  await new Promise((r) => setTimeout(r, 50))
  // 换一个「进程」：清掉内存里的（用新的项目对象同 id 不行，内存按 id 记）→ 直接改存盘时间模拟重启后的旧表
  const { _forgetForTest } = await import('./index.ts')
  _forgetForTest()
  const calls2: string[] = []
  const next: GtClassRow[] = [...ROWS, ['W_Shop', 'Object', 'umg', '/Game/W_Shop', 0]]
  const d2 = deps(calls2, () => next)
  const a = await classIndex(p, {}, d2)
  assert.equal(a.refreshing, true)
  assert.equal(a.rows?.length, 3)
  const b = await classIndex(p, { wait: true, v: a.v }, d2)
  assert.equal(b.rows?.length, 4)
  assert.deepEqual(calls2, ['live'])
})

test('UE 和磁盘都读不到：第一次报错', async () => {
  const p = { id: 'p3', root: '/z' } as UeProject
  await assert.rejects(
    classIndex(
      p,
      {},
      {
        live: async () => {
          throw new Error('没开')
        },
        disk: async () => {
          throw new Error('读不到')
        },
      },
    ),
    /没开/,
  )
})
