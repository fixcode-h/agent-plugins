// 跳转本地索引：读 UEToVS 的 blueprints.jsonl.gz / lua-index.json，没有时扫磁盘（按目录增量）。
// 用法：node --test ue/server/search-index/search-index.test.ts（Node 22 直接跑 .ts，不需要 UE、UEToVS）
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { gzipSync } from 'node:zlib'
import type { UeProject } from '../types.ts'
import { searchIndex } from './index.ts'

let base = ''
let root = ''

const touch = async (f: string, body = '') => {
  await mkdir(path.dirname(f), { recursive: true })
  await writeFile(f, body)
}
const project = (id: string, r = root) => ({ id, root: r, engineDir: '', engine: { dir: '' } }) as unknown as UeProject

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'ue-index-'))
  root = path.join(base, 'Proj')
  await touch(path.join(root, 'Content', 'Characters', 'BP_Hero.uasset'))
  await touch(path.join(root, 'Content', 'Maps', 'Main.umap'))
  await touch(path.join(root, 'Content', 'Maps', '__ExternalActors__', 'A', 'X1.uasset'))
  await touch(path.join(root, 'Plugins', 'Kit', 'Kit.uplugin'), JSON.stringify({ CanContainContent: true }))
  await touch(path.join(root, 'Plugins', 'Kit', 'Content', 'UI', 'WBP_Bag.uasset'))
  await touch(path.join(root, 'Content', 'Script', 'UI', 'BagPanel.lua'))
})
after(() => rm(base, { recursive: true, force: true }))

test('没有 UEToVS 的索引时扫磁盘：项目和插件 Content、跳过 __ExternalActors__、Lua 模块', async () => {
  const idx = await searchIndex(project('disk'))
  assert.equal(idx.source.assets, 'disk')
  assert.deepEqual(idx.assets.map((a) => a[0]).sort(), [
    '/Game/Characters/BP_Hero.BP_Hero',
    '/Game/Maps/Main.Main',
    '/Kit/UI/WBP_Bag.WBP_Bag',
  ])
  assert.equal(idx.assets.find((a) => a[0].includes('Main'))?.[1], 'World')
  assert.equal(idx.source.lua, 'disk')
  assert.deepEqual(
    idx.lua.map((l) => l[0]),
    ['UI.BagPanel'],
  )
})

test('磁盘增量：没变时版本不变，新加文件后版本变、能搜到', async () => {
  const p = project('disk')
  const a = await searchIndex(p, true)
  const b = await searchIndex(p, true)
  assert.equal(a.version, b.version)
  const dir = path.join(root, 'Content', 'Characters')
  await touch(path.join(dir, 'BP_Enemy.uasset'))
  // 有的文件系统目录时间精度粗，手动往后拨一下，模拟真实的新增
  const later = new Date(Date.now() + 5000)
  await utimes(dir, later, later)
  const c = await searchIndex(p, true)
  assert.notEqual(c.version, b.version)
  assert.ok(c.assets.some((x) => x[0] === '/Game/Characters/BP_Enemy.BP_Enemy'))
})

test('有 UEToVS 的索引时直接用：蓝图带父类、控件蓝图认出来、外层解决方案只要本项目的', async () => {
  const lines = [
    { format: 1 },
    {
      p: path.join(root, 'Content', 'Characters', 'BP_Hero.uasset'),
      o: '/Game/Characters/BP_Hero.BP_Hero',
      pc: '/Script/MyGame.HeroCharacter',
      npc: '/Script/MyGame.HeroCharacter',
      gc: '/Game/Characters/BP_Hero.BP_Hero_C',
      n: ['Foo'],
    },
    {
      p: path.join(root, 'Plugins', 'Kit', 'Content', 'UI', 'WBP_Bag.uasset'),
      pc: '/Script/UMG.UserWidget',
      npc: '/Script/UMG.UserWidget',
    },
    { p: path.join(root, 'Content', 'Data', 'DT_Items.uasset'), o: '/Game/Data/DT_Items.DT_Items' },
    { p: path.join(base, 'Other', 'Content', 'BP_X.uasset'), o: '/Game/BP_X.BP_X' },
  ]
  // 解决方案在项目外层（base）：要按项目目录筛掉 Other 项目
  await touch(
    path.join(base, '.vs', 'UEToVS', 'Blueprints', 'blueprints.jsonl.gz'),
    gzipSync(lines.map((l) => JSON.stringify(l)).join('\n') + '\n') as unknown as string,
  )
  await touch(
    path.join(base, '.vs', 'UEToVS', 'Lua', 'lua-index.json'),
    JSON.stringify({
      format: 1,
      files: [{ path: path.join(root, 'Content', 'Script', 'Game', 'Main.lua'), module: 'Game.Main' }],
    }),
  )
  const idx = await searchIndex(project('uetovs'))
  assert.equal(idx.source.assets, 'uetovs')
  assert.deepEqual(idx.assets, [
    ['/Game/Characters/BP_Hero.BP_Hero', 'Blueprint', 'HeroCharacter'],
    ['/Kit/UI/WBP_Bag.WBP_Bag', 'WidgetBlueprint', 'UserWidget'],
    ['/Game/Data/DT_Items.DT_Items', ''],
  ])
  assert.equal(idx.source.lua, 'uetovs')
  assert.deepEqual(
    idx.lua.map((l) => l[0]),
    ['Game.Main'],
  )
})

test('UEToVS 的格式对不上就退回扫磁盘', async () => {
  const r2 = path.join(base, 'Proj2')
  await touch(path.join(r2, 'Content', 'A.uasset'))
  await touch(
    path.join(r2, '.vs', 'UEToVS', 'Blueprints', 'blueprints.jsonl.gz'),
    gzipSync('{"format":99}\n') as unknown as string,
  )
  const idx = await searchIndex(project('fmt', r2))
  assert.equal(idx.source.assets, 'disk')
  assert.deepEqual(idx.assets, [['/Game/A.A', '']])
})
