// 资源页右栏文件夹内容表的状态列（磁盘大小、P4 签出）：不需要 UE 和 p4。
// 用法：node --test ue/server/asset-folders-stat.test.ts
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { diskStats, mergeStats, nameOf, parseFstat } from './asset-folders-stat.ts'

let dir = ''
after(() => dir && rm(dir, { recursive: true, force: true }))

test('nameOf 取资源名', () => {
  assert.equal(nameOf('/Game/UI/WBP_Bag.WBP_Bag'), 'WBP_Bag')
  assert.equal(nameOf('/Game/Maps/Main'), 'Main')
})

test('diskStats 只认 .uasset / .umap，按名字不分大小写', async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ue-stat-'))
  await writeFile(path.join(dir, 'BP_Hero.uasset'), 'x'.repeat(10))
  await writeFile(path.join(dir, 'Main.umap'), 'xx')
  await writeFile(path.join(dir, 'readme.txt'), 'nope')
  const m = await diskStats(dir)
  assert.equal(m.size, 2)
  assert.equal(m.get('bp_hero')?.size, 10)
  assert.equal(m.get('main')?.size, 2)
  assert.equal((await diskStats(path.join(dir, 'missing'))).size, 0)
  assert.equal((await diskStats('')).size, 0)
})

test('parseFstat 认自己签出和别人签出，没人签出的不留', () => {
  const out = [
    '... depotFile //depot/Game/Content/UI/WBP_Bag.uasset',
    '... clientFile D:\\Proj\\Content\\UI\\WBP_Bag.uasset',
    '... headAction edit',
    '... action edit',
    '... change default',
    '',
    '... depotFile //depot/Game/Content/UI/WBP_Slot.uasset',
    '... clientFile D:\\Proj\\Content\\UI\\WBP_Slot.uasset',
    '... otherOpen0 lee@lee-ws',
    '... otherAction0 edit',
    '... otherOpen 1',
    '',
    '... depotFile //depot/Game/Content/UI/T_Bg.uasset',
    '... clientFile D:\\Proj\\Content\\UI\\T_Bg.uasset',
    '... headAction add',
    '',
  ].join('\r\n')
  const m = parseFstat(out)
  assert.deepEqual(m.get('wbp_bag'), { action: 'edit' })
  assert.deepEqual(m.get('wbp_slot'), { others: ['lee@lee-ws'] })
  assert.equal(m.has('t_bg'), false)
})

test('mergeStats 按名字并上大小和签出', () => {
  const items = [
    { name: 'WBP_Bag', path: '/Game/UI/WBP_Bag.WBP_Bag', class: 'WidgetBlueprint' },
    { name: 'DA_New', path: '/Game/UI/DA_New.DA_New', class: 'DataAsset' },
  ]
  const res = mergeStats(
    items,
    new Map([['wbp_bag', { size: 5, mtime: '2026-11-16T00:00:00.000Z' }]]),
    new Map([['wbp_bag', { action: 'edit' }]]),
  )
  assert.equal(res[0].size, 5)
  assert.deepEqual(res[0].vcs, { action: 'edit' })
  assert.equal(res[1].size, undefined)
  assert.equal(res[1].vcs, undefined)
})
