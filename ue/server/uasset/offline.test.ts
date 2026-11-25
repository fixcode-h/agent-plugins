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
import { BASE, CHILD, baseBlueprint, childBlueprint } from '../../shared/uasset/test/samples-bp.ts'
import { nativeToFetch, putNative } from './defaults/native-cache.ts'
import type { UeProject } from '../types.ts'
import { setCtx } from '../util.ts'
import { canOffline, runOffline } from './offline/index.ts'
import { OfflineReadError } from './read.ts'

let base = ''
let project: UeProject
const P = '/Game/Data/DA_Sword.DA_Sword'

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'ue-offline-'))
  setCtx({
    dataDir: path.join(base, 'data'),
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
  const data = path.join(base, 'Content', 'Data')
  await mkdir(data, { recursive: true })
  await writeFile(path.join(data, 'DA_Sword.uasset'), dataAsset())
  await writeFile(path.join(data, 'DT_Items.uasset'), dataTable())
  await writeFile(
    path.join(data, 'DA_Cooked.uasset'),
    buildPackage({ ...dataAssetSpec('/Game/Data/DA_Cooked'), flags: 0x80000000 }),
  )
  const bpDir = path.join(base, 'Content', 'BP')
  await mkdir(bpDir, { recursive: true })
  await writeFile(path.join(bpDir, 'BP_Base.uasset'), baseBlueprint())
  await writeFile(path.join(bpDir, 'BP_Child.uasset'), childBlueprint())
  project = { root: base, id: 'p' } as UeProject
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

type P = { name: string; value: unknown; changed?: boolean; category?: string }
const byName = (r: Record<string, unknown>) => new Map((r.props as P[]).map((p) => [p.name, p]))

test('类默认值按原型链合：父蓝图文件里的值垫在下面，C++ 默认值没记下时说清楚并记进待补', async () => {
  const r = await run('props', { path: `${CHILD}.BP_Child` })
  const m = byName(r)
  assert.equal(m.get('Speed')?.value, 5)
  assert.equal(m.get('Speed')?.changed, true)
  // 子蓝图文件里没有 Health：从 BP_Base 的类默认值来，不算这一层改过
  assert.equal(m.get('Health')?.value, 100)
  assert.equal(m.get('Health')?.changed, undefined)
  assert.match(String(r.note), /Actor 的 C\+\+ 默认值还没记下/)
  assert.ok((await nativeToFetch('p', 50)).includes('/Script/Engine.Default__Actor'))
})

test('记下 C++ 默认值以后：没改过的属性也列出来，顺序和分类照编辑器', async () => {
  await putNative('p', '/Script/Engine.Default__Actor', {
    at: Date.now(),
    props: [
      { name: 'bReplicates', type: 'bool', category: 'Replication', value: false },
      { name: 'Speed', type: 'int32', category: 'Game', value: 0 },
    ],
  })
  const r = await run('props', { path: `${CHILD}.BP_Child` })
  assert.deepEqual(
    (r.props as P[]).map((p) => p.name),
    ['bReplicates', 'Speed', 'Health'],
  )
  const m = byName(r)
  assert.equal(m.get('bReplicates')?.category, 'Replication')
  assert.equal(m.get('Speed')?.category, 'Game')
  assert.match(String(r.note), /上次编辑器开着时记下的 C\+\+ 默认值/)
  assert.ok(!(await nativeToFetch('p', 50)).includes('/Script/Engine.Default__Actor'))
})

test('结构体只存改过的成员：按成员合到默认值上', async () => {
  await putNative('p', '/Script/Engine.Default__StaticMeshComponent', {
    at: Date.now(),
    props: [
      { name: 'CastShadow', type: 'bool', value: true },
      { name: 'bHiddenInGame', type: 'bool', value: false },
      { name: 'BodyInstance', type: 'FBodyInstance', value: { collisionProfileName: 'BlockAll', massScale: 1 } },
    ],
  })
  // 子蓝图改了父蓝图组件：原型是父蓝图里的同名组件模板，再往下是 C++ 组件类的默认值
  const r = await run('props', { path: `${CHILD}.BP_Child_C:Mesh_GEN_VARIABLE` })
  const m = byName(r)
  assert.equal(m.get('bHiddenInGame')?.value, true)
  assert.equal(m.get('bHiddenInGame')?.changed, true)
  assert.equal(m.get('CastShadow')?.value, false)
  assert.equal(m.get('CastShadow')?.changed, undefined)
  assert.deepEqual(m.get('BodyInstance')?.value, { collisionProfileName: 'BlockAll', massScale: 1 })
  assert.equal((await run('get', { path: `${CHILD}.BP_Child_C:Mesh_GEN_VARIABLE`, prop: 'CastShadow' })).value, false)
})

test('组件：带上父蓝图加的组件（子蓝图文件里没有的也列出来）', async () => {
  const base = await run('components', { path: `${BASE}.BP_Base` })
  assert.deepEqual(
    (base.items as { name: string }[]).map((x) => x.name),
    ['Mesh'],
  )
  const r = await run('components', { path: `${CHILD}.BP_Child` })
  const items = r.items as { name: string; path: string; inherited?: boolean }[]
  assert.equal(items.length, 1)
  assert.equal(items[0].name, 'Mesh')
  assert.equal(items[0].inherited, true)
  assert.equal(items[0].path, `${CHILD}.BP_Child_C:Mesh_GEN_VARIABLE`)
})

test('数据表：记下行结构的默认值以后，没写的格子补上，列按编辑器的顺序', async () => {
  const before = await run('datatable', { path: '/Game/Data/DT_Items' })
  assert.match(String(before.note), /自动记下默认值/)
  assert.ok((await nativeToFetch('p', 50)).includes('/Script/Game.ItemRow@/Game/Data/DT_Items.DT_Items'))
  await putNative('p', '/Script/Game.ItemRow', {
    at: Date.now(),
    columns: [
      { name: 'Price', type: 'int32', value: 0, has: true },
      { name: 'Label', type: 'FString', value: 'none', has: true },
      { name: 'Weight', type: 'float', value: 1, has: true },
    ],
  })
  const r = await run('datatable', { path: '/Game/Data/DT_Items' })
  assert.deepEqual(
    (r.columns as { name: string }[]).map((c) => c.name),
    ['Price', 'Label', 'Weight'],
  )
  assert.deepEqual((r.rows as unknown[])[1], { name: 'Pear', values: { Price: 5, Label: 'none', Weight: 1 } })
  assert.match(String(r.note), /上次编辑器开着时记下的行结构默认值/)
})

test('编辑器开着时在后台补：C++ 默认值用 props 读，行结构对着表推，找不到的记下别再问', async () => {
  const { createServer } = await import('node:http')
  const { primeNativeDefaults } = await import('./defaults/prime.ts')
  const { nativeDefaults, wantNative } = await import('./defaults/native-cache.ts')
  const asked: string[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const { op, args } = JSON.parse(body) as { op: string; args: Record<string, unknown> }
      asked.push(`${op} ${String(args.path)}`)
      const reply =
        op === 'props' && args.path === '/Script/Engine.Default__Pawn'
          ? { ok: true, props: [{ name: 'bCanBeDamaged', type: 'bool', value: true, readOnly: false }] }
          : op === 'datatable'
            ? {
                ok: true,
                columns: [
                  { name: 'Price', type: 'int32' },
                  { name: 'Label', type: 'FString' },
                ],
                rows: [{ name: 'Pear', values: { Price: 5, Label: 'pear?' } }],
              }
            : { ok: false, error: `找不到对象：${String(args.path)}` }
      res.end(JSON.stringify(reply))
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const port = (server.address() as { port: number }).port
  await wantNative('q', '/Script/Engine.Default__Pawn')
  await wantNative('q', '/Script/Engine.Default__Pawn:Nope')
  await wantNative('q', '/Script/Game.ItemRow@/Game/Data/DT_Items.DT_Items')
  const card = { pid: 1, port, token: '', kind: 'editor', engine: '', bridge: '', project: '', startedAt: '' }
  await primeNativeDefaults({ ...project, id: 'q' }, card)
  server.close()
  assert.equal(asked.length, 3)
  const pawn = await nativeDefaults('q', '/Script/Engine.Default__Pawn')
  assert.deepEqual(pawn?.props, [{ name: 'bCanBeDamaged', type: 'bool', value: true }])
  assert.equal((await nativeDefaults('q', '/Script/Engine.Default__Pawn:Nope'))?.missing, true)
  const row = await nativeDefaults('q', '/Script/Game.ItemRow')
  // Pear 在文件里没写 Label：编辑器给的就是默认值；Price 每行都写了，不知道默认值
  assert.deepEqual(
    row?.columns?.map((c) => [c.name, c.has, c.value]),
    [
      ['Price', false, undefined],
      ['Label', true, 'pear?'],
    ],
  )
  assert.deepEqual(await nativeToFetch('q', 50), [])
})
