// 面板侧的 GameTest v4 操作：gt.migrate（备份、演练、_settings）、gt.props 补 Lua 声明字段、版本门槛。
// 用法：node --test ue/server/uekit/gt-ref/gt-ref.test.ts
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import type { PluginServerContext } from '../../../../sdk/server.ts'
import { setCtx } from '../../util.ts'
import { compactMigrate, gtMigrate } from './migrate.ts'
import { gameTestTooOld, gtRefOp } from './ops.ts'
import { luaKind, mergeLuaProps } from './lua-props.ts'

let proj = ''
let scen = ''
const v3 = {
  kind: 'gametest-scenario',
  schemaVersion: 3,
  name: '买东西',
  steps: [{ id: 's1', action: 'click', target: 'WBP_Shop:Root/BtnBuy' }],
}

before(async () => {
  proj = await mkdtemp(path.join(tmpdir(), 'gt-ref-'))
  scen = path.join(proj, 'docs', 'GameTest')
  await mkdir(path.join(scen, 'sub'), { recursive: true })
  await mkdir(path.join(proj, 'Content', 'Script', 'UI'), { recursive: true })
  setCtx({
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
})
after(() => rm(proj, { recursive: true, force: true }))

test('gt.migrate：演练不写盘；写回前存 .v3.bak，已有就加序号；跟着原文件的缩进', async () => {
  await writeFile(path.join(scen, 'a.json'), JSON.stringify(v3, null, 2))
  const dry = await gtMigrate(proj, { scenario: 'a.json', dryRun: true })
  assert.equal(dry.dryRun, true)
  assert.equal(dry.changed[0].path, 'a.json')
  assert.equal(JSON.parse(await readFile(path.join(scen, 'a.json'), 'utf8')).schemaVersion, 3)

  const r1 = await gtMigrate(proj, { scenario: 'a.json' })
  assert.equal(r1.changed[0].backup, 'a.json.v3.bak')
  const text = await readFile(path.join(scen, 'a.json'), 'utf8')
  const doc = JSON.parse(text)
  assert.equal(doc.schemaVersion, 4)
  assert.deepEqual(doc.steps[0].target, { obj: { class: 'WBP_Shop' }, part: 'BtnBuy' })
  assert.match(text, /\n {2}"kind"/)

  // 已经是 v4：跳过；再放一份 v3 进去迁，备份加序号
  assert.equal((await gtMigrate(proj, { scenario: 'a.json' })).skipped.length, 1)
  await writeFile(path.join(scen, 'a.json'), JSON.stringify(v3))
  const r2 = await gtMigrate(proj, { scenario: 'a.json' })
  assert.equal(r2.changed[0].backup, 'a.json.v3.1.bak')
})

test('gt.migrate all：场景和 _settings.json 一起，非场景、坏 JSON 分别进 skipped / errors', async () => {
  await writeFile(
    path.join(scen, 'sub', 'b.json'),
    JSON.stringify({ ...v3, steps: [{ action: 'invoke', object: 'x', function: 'F' }] }),
  )
  await writeFile(path.join(scen, 'sub', 'lib.json'), JSON.stringify({ kind: 'forge-config' }))
  await writeFile(path.join(scen, 'sub', 'bad.json'), '{')
  await writeFile(path.join(scen, '_vars.json'), '{}')
  await writeFile(
    path.join(scen, '_settings.json'),
    JSON.stringify({ objectKeys: [{ class: 'BP_Npc', by: ['NpcId'] }], other: 1 }, null, '\t'),
  )
  const r = await gtMigrate(proj, { all: true })
  const changed = r.changed.map((x) => x.path).sort()
  assert.ok(changed.includes('_settings.json') && changed.includes('sub/b.json'), JSON.stringify(r))
  assert.ok(r.skipped.some((x) => x.path === 'sub/lib.json'))
  assert.ok(r.errors.some((x) => x.path === 'sub/bad.json'))
  assert.ok(!JSON.stringify(r).includes('_vars.json'))
  const settings = JSON.parse(await readFile(path.join(scen, '_settings.json'), 'utf8'))
  assert.deepEqual(settings.identRules, [{ class: 'BP_Npc', ident: ['@self.NpcId'] }])
  assert.equal(settings.objectKeys, undefined)
  assert.equal(settings.other, 1)
  const b = JSON.parse(await readFile(path.join(scen, 'sub', 'b.json'), 'utf8'))
  assert.equal(b.steps[0].action, 'obj.call')
  // 备份不是 .json，场景列表不会当成场景
  assert.ok((await readdir(path.join(scen, 'sub'))).includes('b.json.v3.bak'))
  assert.ok(JSON.stringify(compactMigrate(r)).length <= 4000)
})

test('gt.migrate：不写 scenario 也不写 all 报错，出了场景根拒绝', async () => {
  await assert.rejects(gtMigrate(proj, {}), /scenario/)
  await assert.rejects(gtMigrate(proj, { scenario: '../x.json' }))
})

test('Lua 类型 → kind（协议 7.5）', () => {
  assert.equal(luaKind('number'), 'float')
  assert.equal(luaKind('integer'), 'int')
  assert.equal(luaKind('string?'), 'string')
  assert.equal(luaKind('boolean|nil'), 'bool')
  assert.equal(luaKind('ItemData[]'), 'array')
  assert.equal(luaKind('table'), 'array')
  assert.equal(luaKind('UI.ShopPanel'), undefined)
})

test('Lua 声明合进 self 组：UE 给了的保留值，只有声明的带 note，没有 self 组时新建', () => {
  const decl = {
    file: 'UI/Shop.lua',
    fields: [
      { name: 'shopId', type: 'integer', kind: 'field' as const, line: 3, note: '商店编号' },
      { name: 'owner', type: 'Npc', kind: 'self' as const, line: 9 },
      { name: 'title', type: 'string', kind: 'field' as const, line: 4 },
    ],
  }
  const groups = [
    {
      id: 'self',
      title: 'Self',
      items: [
        {
          prop: '@lua.title',
          name: 'title',
          src: 'lua' as const,
          type: 'any',
          kind: 'string' as const,
          value: '杂货铺',
        },
      ],
    },
  ]
  const r = mergeLuaProps(groups, decl, { selfTitle: '自己' })
  const items = r.groups[0].items
  assert.equal(r.added, 2)
  assert.equal(items[0].value, '杂货铺')
  assert.equal(items[0].type, 'string')
  assert.equal(groups[0].items[0].type, 'any')
  const id = items.find((x) => x.name === 'shopId')!
  assert.equal(id.prop, '@lua.shopId')
  assert.equal(id.kind, 'int')
  assert.ok(id.ops?.includes('eq'))
  assert.match(id.note ?? '', /商店编号.*UI\/Shop\.lua:3/)
  const owner = items.find((x) => x.name === 'owner')!
  assert.equal(owner.comparable, false)
  assert.equal(mergeLuaProps([], decl, { selfTitle: '自己', filter: 'shop' }).groups[0].items.length, 1)
})

test('版本门槛：GameTest 低于 2.0.0 或没加载时报升级；名片没列扩展时交给 UE', () => {
  assert.match(gameTestTooOld({ extensions: [{ name: 'GameTest', version: '1.12.0' }] }) ?? '', /2\.0\.0/)
  assert.ok(gameTestTooOld({ extensions: [{ name: 'AssetForge', version: '1.0.0' }] }))
  assert.equal(gameTestTooOld({ extensions: [{ name: 'GameTest', version: '2.0.0' }] }), undefined)
  assert.equal(gameTestTooOld({}), undefined)
})

test('gt.props：UE 太旧时只要知道 luaModule 照样返回 Lua 声明字段；别的操作直接报升级', async () => {
  await writeFile(
    path.join(proj, 'Content', 'Script', 'UI', 'Shop.lua'),
    '---@class ShopPanel\n---@field shopId integer 商店编号\nlocal M = {}\nreturn M\n',
  )
  const old = { extensions: [{ name: 'GameTest', version: '1.12.0' }] }
  const deps = {
    project: { root: proj },
    pick: async () => old,
    send: async () => ({}),
  }
  const r = await gtRefOp('gt.props', { class: 'WBP_Shop', luaModule: 'UI.Shop' }, deps)
  assert.match(String(r.unavailable), /2\.0\.0/)
  assert.equal(r.luaFile, 'UI/Shop.lua')
  const g = (r.groups as { id: string; items: { prop: string }[] }[])[0]
  assert.equal(g.id, 'self')
  assert.deepEqual(
    g.items.map((x) => x.prop),
    ['@lua.shopId'],
  )
  await assert.rejects(gtRefOp('gt.tree', {}, deps), /2\.0\.0/)
  await assert.rejects(gtRefOp('gt.props', { class: 'WBP_Shop' }, deps), /2\.0\.0/)
  // UE 回「不认识的操作」也换成升级提示；luaModule 不转给 UE
  let sent: Record<string, unknown> = {}
  const fresh = {
    project: { root: proj },
    pick: async () => ({}),
    send: async (_c: unknown, a: Record<string, unknown>) => {
      sent = a
      if (a.node) throw new Error('unknown op gt.refFor')
      return { class: 'WBP_Shop_C', luaModule: 'UI.Shop', groups: [] }
    },
  }
  await assert.rejects(gtRefOp('gt.refFor', { node: 'n1' }, fresh), /请升级 GameTest/)
  const ok = await gtRefOp('gt.props', { class: 'WBP_Shop', luaModule: 'X' }, fresh)
  assert.equal(sent.luaModule, undefined)
  assert.equal(ok.unavailable, undefined)
  assert.equal((ok.groups as { items: unknown[] }[])[0].items.length, 1)
})
