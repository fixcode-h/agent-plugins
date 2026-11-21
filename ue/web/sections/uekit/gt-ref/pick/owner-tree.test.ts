import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ownerChain, ownerRows } from './owner-tree.ts'

test('按所属成树：共有的外层合成一行', () => {
  assert.deepEqual(ownerChain('/Game/Maps/Main.Main:PersistentLevel.BP_Door_C_1'), ['Main', 'PersistentLevel'])
  const items = [
    { name: 'A', path: '/Game/Maps/Main.Main:PersistentLevel.A' },
    { name: 'B', path: '/Game/Maps/Main.Main:PersistentLevel.Room.B' },
    { name: 'C' },
  ]
  const rows = ownerRows(
    items,
    (x) => x.path,
    () => true,
  )
  assert.deepEqual(
    rows.map((r) => [r.depth, r.label ?? r.item?.name]),
    [
      [0, 'C'],
      [0, 'Main › PersistentLevel'],
      [1, 'A'],
      [1, 'Room'],
      [2, 'B'],
    ],
  )
})
