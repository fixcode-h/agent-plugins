// 文件夹树的磁盘兜底（assets.children 没有编辑器或桥接旧时）：用临时目录造 Content / Plugins 结构。
// 用法：node --test ue/server/asset-folders.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import type { PluginServerContext } from '../../sdk/server.ts'
import { diskChildren, mergeWithDisk, pickAssetCard, projectPlugins, unsupported } from './asset-folders-disk.ts'
import type { Card } from './instances.ts'
import { setCtx } from './util.ts'

let root = ''
let engine = ''

const touch = async (f: string, body = '') => {
  await mkdir(path.dirname(f), { recursive: true })
  await writeFile(f, body)
}

before(async () => {
  // 文案原样返回（插值照填），不需要面板
  setCtx({
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
  const base = await mkdtemp(path.join(tmpdir(), 'ue-folders-'))
  root = path.join(base, 'Proj')
  engine = path.join(base, 'UE')
  await touch(path.join(root, 'Content', 'Blueprints', 'BP_Hero.uasset'))
  await touch(path.join(root, 'Content', 'Blueprints', 'readme.txt'))
  await touch(path.join(root, 'Content', 'Maps', 'Main.umap'))
  await touch(path.join(root, 'Content', 'Maps', 'Main_BuiltData.uasset'))
  await mkdir(path.join(root, 'Content', 'Empty'), { recursive: true })
  await touch(path.join(root, 'Content', 'DT_Items.uasset'))
  // 能放内容的插件（套在分组目录里）、不能放内容的、没有 Content 目录的
  await touch(path.join(root, 'Plugins', 'Group', 'MyPlugin', 'MyPlugin.uplugin'), '{"CanContainContent": true}')
  await touch(path.join(root, 'Plugins', 'Group', 'MyPlugin', 'Content', 'UI', 'WBP_Main.uasset'))
  await touch(path.join(root, 'Plugins', 'CodeOnly', 'CodeOnly.uplugin'), '{"CanContainContent": false}')
  await mkdir(path.join(root, 'Plugins', 'CodeOnly', 'Content'), { recursive: true })
  await touch(path.join(root, 'Plugins', 'NoDir', 'NoDir.uplugin'), '﻿{"CanContainContent": true}')
  await touch(path.join(engine, 'Engine', 'Content', 'BasicShapes', 'Cube.uasset'))
})

after(async () => {
  await rm(path.dirname(root), { recursive: true, force: true })
})

test('项目插件：只认 CanContainContent 且有 Content 目录的', async () => {
  const list = await projectPlugins(root)
  assert.deepEqual(
    list.map((m) => m.name),
    ['MyPlugin'],
  )
})

test('挂载根：Content、项目插件、Engine', async () => {
  const r = await diskChildren(root, engine, '/')
  assert.equal(r.source, 'disk')
  assert.deepEqual(
    r.folders.map((f) => [f.path, f.root]),
    [
      ['/Game', 'game'],
      ['/MyPlugin', 'plugin'],
      ['/Engine', 'engine'],
    ],
  )
  // /Game 下：Blueprints、Maps、Empty 三个文件夹 + DT_Items
  assert.equal(r.folders[0].count, 4)
})

test('一层：文件夹带子项数，资源给对象路径，.umap 是 World', async () => {
  const r = await diskChildren(root, engine, '/Game')
  assert.deepEqual(
    r.folders.map((f) => [f.name, f.path, f.count]),
    [
      ['Blueprints', '/Game/Blueprints', 1],
      ['Empty', '/Game/Empty', 0],
      ['Maps', '/Game/Maps', 2],
    ],
  )
  assert.deepEqual(r.items, [{ name: 'DT_Items', path: '/Game/DT_Items.DT_Items', class: '' }])
  const maps = await diskChildren(root, engine, '/Game/Maps/')
  assert.deepEqual(
    maps.items.map((i) => [i.path, i.class]),
    [
      ['/Game/Maps/Main.Main', 'World'],
      ['/Game/Maps/Main_BuiltData.Main_BuiltData', ''],
    ],
  )
})

test('插件挂载点和引擎内容', async () => {
  const r = await diskChildren(root, engine, '/MyPlugin/UI')
  assert.deepEqual(r.items, [{ name: 'WBP_Main', path: '/MyPlugin/UI/WBP_Main.WBP_Main', class: '' }])
  const e = await diskChildren(root, engine, '/Engine')
  assert.deepEqual(
    e.folders.map((f) => f.path),
    ['/Engine/BasicShapes'],
  )
  // 找不到引擎目录：返回空并带提示，不报错
  const none = await diskChildren(root, '', '/Engine')
  assert.equal(none.folders.length + none.items.length, 0)
  assert.ok(none.note)
  const rootNoEngine = await diskChildren(root, '', '/')
  assert.equal(rootNoEngine.folders.at(-1)?.count, undefined)
})

test('按类型筛：World 认得出，别的类型只列文件夹并提示', async () => {
  const w = await diskChildren(root, engine, '/Game/Maps', 'World')
  assert.deepEqual(
    w.items.map((i) => i.name),
    ['Main'],
  )
  const bp = await diskChildren(root, engine, '/Game', 'Blueprint')
  assert.equal(bp.items.length, 0)
  assert.equal(bp.folders.length, 3)
  assert.ok(bp.note)
})

test('超过上限截断，标 more 和总数', async () => {
  const r = await diskChildren(root, engine, '/Game', '', 2)
  assert.equal(r.folders.length, 2)
  assert.equal(r.items.length, 0)
  assert.equal(r.more, true)
  assert.equal(r.total, 4)
})

test('出错：没有的挂载点、没有的文件夹、..', async () => {
  await assert.rejects(diskChildren(root, engine, '/Nope'), /Nope/)
  await assert.rejects(diskChildren(root, engine, '/Game/Missing'), /Missing/)
  await assert.rejects(diskChildren(root, engine, '/Game/../..'))
})

test('选进程：编辑器 > 后台编辑器 > 游戏，不问专用服务器；认得出「不支持」', () => {
  const card = (pid: number, kind: string) => ({ pid, kind }) as Card
  assert.equal(pickAssetCard([card(1, 'game'), card(2, 'background'), card(3, 'editor')])?.pid, 3)
  assert.equal(pickAssetCard([card(1, 'game'), card(2, 'background')])?.pid, 2)
  assert.equal(pickAssetCard([card(1, 'game')])?.pid, 1)
  assert.equal(pickAssetCard([card(4, 'server')]), undefined)
  assert.equal(pickAssetCard([card(2, 'background'), card(3, 'editor')], 2)?.pid, 2)
  assert.ok(unsupported('这个进程不支持 assets.children'))
  assert.ok(unsupported('unknown op: assets.children'))
  assert.ok(!unsupported('UE 进程 3 在 30 秒内没有回应'))
})

test('游戏进程的注册表不全：并上磁盘列到的，类型以注册表为准', () => {
  const r = mergeWithDisk(
    {
      path: '/Game',
      folders: [{ name: 'Maps', path: '/Game/Maps' }],
      items: [{ name: 'BP_Hero', path: '/Game/BP_Hero.BP_Hero', class: 'Blueprint' }],
      source: 'bridge',
    },
    {
      path: '/Game',
      folders: [
        { name: 'maps', path: '/Game/maps', count: 2 },
        { name: 'Data', path: '/Game/Data', count: 3 },
      ],
      items: [
        { name: 'BP_Hero', path: '/Game/BP_Hero.BP_Hero', class: '' },
        { name: 'DT_Items', path: '/Game/DT_Items.DT_Items', class: '' },
      ],
      source: 'disk',
    },
  )
  assert.equal(r.source, 'bridge')
  assert.deepEqual(
    r.folders.map((f) => f.path),
    ['/Game/Data', '/Game/Maps'],
  )
  assert.deepEqual(
    r.items.map((i) => `${i.name}:${i.class}`),
    ['BP_Hero:Blueprint', 'DT_Items:'],
  )
})
