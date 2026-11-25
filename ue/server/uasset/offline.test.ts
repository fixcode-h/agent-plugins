// 编辑器没开时的离线操作（server/uasset/offline/）：临时项目里放 test/pack.ts 拼的资源，按 UELink 的形状读回来。
// 用法：node --import ./scripts/lib/panel-register.mjs --test ue/server/uasset/offline.test.ts
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import { buildPackage } from '../../shared/uasset/test/pack.ts'
import { dataAsset, dataAssetSpec, dataTable } from '../../shared/uasset/test/samples.ts'
import type { UeProject } from '../types.ts'
import { setCtx } from '../util.ts'
import { canOffline, runOffline } from './offline/index.ts'
import { OfflineReadError } from './read.ts'

let base = ''
let project: UeProject
const P = '/Game/Data/DA_Sword.DA_Sword'

before(async () => {
  setCtx({
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
  base = await mkdtemp(path.join(tmpdir(), 'ue-offline-'))
  const data = path.join(base, 'Content', 'Data')
  await mkdir(data, { recursive: true })
  await writeFile(path.join(data, 'DA_Sword.uasset'), dataAsset())
  await writeFile(path.join(data, 'DT_Items.uasset'), dataTable())
  await writeFile(
    path.join(data, 'DA_Cooked.uasset'),
    buildPackage({ ...dataAssetSpec('/Game/Data/DA_Cooked'), flags: 0x80000000 }),
  )
  project = { root: base } as UeProject
})

after(() => rm(base, { recursive: true, force: true }))

const run = (op: string, args: Record<string, unknown>) => runOffline(op, { project, args })

test('props：照 UELink 的形状，标只读、来源是文件', async () => {
  const r = await run('props', { path: P })
  assert.equal(r.offline, true)
  assert.deepEqual(r.instance, { pid: 0, kind: 'file' })
  assert.match(String(r.note), /磁盘上的文件/)
  const props = r.props as { name: string; value: unknown; readOnly: boolean; container?: string; count?: number }[]
  assert.deepEqual(
    props.map((p) => p.name),
    ['Damage', 'Title', 'Enabled', 'Tags', 'Size', 'Part'],
  )
  assert.ok(props.every((p) => p.readOnly))
  const tags = props.find((p) => p.name === 'Tags')!
  assert.equal(tags.container, 'array')
  assert.equal(tags.count, 3)
  // 子对象按路径读
  const sub = await run('props', { path: `${P}:Blade`, filter: 'we' })
  assert.deepEqual(
    (sub.props as { name: string }[]).map((p) => p.name),
    ['Weight'],
  )
})

test('get：顶层属性和结构体成员', async () => {
  assert.equal((await run('get', { path: P, prop: 'Damage' })).value, 42)
  assert.equal((await run('get', { path: P, prop: 'Size.Width' })).value, 5)
  await assert.rejects(run('get', { path: P, prop: 'Missing' }), /没改过/)
})

test('asset.describe：类、标签、子对象、依赖', async () => {
  const r = await run('asset.describe', { path: P })
  assert.equal(r.class, 'ItemData')
  assert.deepEqual(r.tags, { Rarity: 'Epic' })
  assert.equal(r.subobjectCount, 1)
  assert.equal(r.dependencies, 1)
})

test('datatable / datatable.row', async () => {
  const r = await run('datatable', { path: '/Game/Data/DT_Items.DT_Items' })
  assert.equal(r.struct, 'ItemRow')
  assert.equal(r.total, 2)
  assert.deepEqual(
    (r.columns as { name: string }[]).map((c) => c.name),
    ['Price', 'Label'],
  )
  assert.deepEqual((r.rows as unknown[])[1], { name: 'Pear', values: { Price: 5 } })
  const f = await run('datatable', { path: '/Game/Data/DT_Items', filter: 'app' })
  assert.equal(f.total, 1)
  const row = await run('datatable.row', { path: '/Game/Data/DT_Items', row: 'Apple' })
  assert.deepEqual(
    (row.props as { name: string }[]).map((p) => p.name),
    ['Price', 'Label'],
  )
})

test('按磁盘路径找资源（对话里点开的 .uasset）', async () => {
  const file = path.join(base, 'Content', 'Data', 'DA_Sword.uasset')
  assert.ok(canOffline('assets', { prefix: file }))
  assert.ok(!canOffline('assets', { prefix: 'DA_' }))
  const r = await run('assets', { prefix: file })
  assert.deepEqual(r.items, [{ path: P, name: 'DA_Sword', class: 'ItemData', package: '/Game/Data/DA_Sword' }])
})

test('读不了的（烘焙过的、没有文件）抛 OfflineReadError，让调用方改走 UE', async () => {
  await assert.rejects(run('props', { path: '/Game/Data/DA_Cooked.DA_Cooked' }), OfflineReadError)
  await assert.rejects(run('props', { path: '/Game/Data/Nope.Nope' }), OfflineReadError)
})

test('asset.textify：编辑器没开时把这一版转成评审看的文本', async () => {
  const file = path.join(base, 'Content', 'Data', 'DT_Items.uasset')
  const r = await run('asset.textify', { file, package: '/Game/Data/DT_Items' })
  const text = String(r.text)
  assert.match(text, /^Class: DataTable/)
  assert.match(text, /Apple: \{"Price":3,"Label":"apple"\}/)
})
