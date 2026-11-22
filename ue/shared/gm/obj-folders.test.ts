// 对象列表文件夹：建、改名 / 挪、删、对象挪文件夹。用法：node scripts/test.mjs ue ue/shared/gm/obj-folders.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addObjFolder, deleteObjFolder, moveObjFolder, moveObject, normFolder, objFolders } from './obj-folders.ts'
import { emptyGm, GmStore } from './schema.ts'

const g0 = () =>
  GmStore.parse({
    ...emptyGm(),
    objects: [
      { name: '商店', folder: '界面/商店', ref: { class: 'WBP_Shop_C' } },
      { name: '玩家', src: '@pawn' },
    ],
    objFolders: ['空的'],
    favs: { gm: [], engine: [], macro: [], objcall: [{ key: 'obj:商店' }] },
  })

test('文件夹：规范路径、含上级和空文件夹', () => {
  assert.equal(normFolder(' /a// b /'), 'a/b')
  assert.deepEqual(objFolders(g0()), ['界面', '界面/商店', '空的'])
  assert.deepEqual(addObjFolder(g0(), '界面').objFolders, ['空的'])
  assert.deepEqual(addObjFolder(g0(), '新/子').objFolders, ['空的', '新/子'])
})

test('文件夹改名带着对象走，删文件夹连同对象和收藏', () => {
  const m = moveObjFolder(g0(), '界面', 'UI')
  assert.equal(m.objects[0].folder, 'UI/商店')
  assert.deepEqual(objFolders(m), ['UI', 'UI/商店', '空的'])
  const d = deleteObjFolder(g0(), '界面')
  assert.deepEqual(d.removed, ['商店'])
  assert.deepEqual(
    d.g.objects.map((o) => o.name),
    ['玩家'],
  )
  assert.deepEqual(d.g.favs.objcall, [])
})

test('对象挪文件夹：原来的文件夹空了也留着', () => {
  const m = moveObject(g0(), '商店', '空的')
  assert.equal(m.objects[0].folder, '空的')
  assert.deepEqual(objFolders(m), ['界面', '界面/商店', '空的'])
  assert.equal(moveObject(g0(), '商店', '').objects[0].folder, undefined)
})
