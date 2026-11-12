/** 草稿：从改动生成、按原样恢复；文件在外面改过时按「改之前的值」判断冲突，插删过行列时不对位 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TableDoc } from '@shared/tables'
import { colOpIn, noEdits, pendingOf, rowOpIn, rowsOf, setCellsIn, undoIn } from './table-edits'
import { draftCount, draftOf, planRestore, restoreEdits } from './table-drafts'

const doc = (rows: string[][], mtime = 't1'): TableDoc => ({
  path: 'Config/Item.xlsx',
  kind: 'xlsx',
  size: 100,
  mtime,
  sheets: [{ name: 'S', rows }],
})
const BASE = [
  ['ID', 'Name', 'Price'],
  ['1', 'a', '10'],
  ['2', 'b', '20'],
]

test('没有改动时没有草稿；有改动时记下行列操作和改之前的值', () => {
  const d = doc(BASE)
  assert.equal(draftOf('p', d, undefined), null)
  assert.equal(draftOf('p', d, noEdits()), null)
  let e = setCellsIn(noEdits(), d.sheets[0], [{ r: 1, c: 1, v: 'A' }])
  e = colOpIn(e, d.sheets[0], { at: 1, n: 1 }, [{ r: 0, c: 1, v: 'Kind' }])
  const draft = draftOf('p', d, e)!
  assert.equal(draft.mtime, 't1')
  assert.deepEqual(draft.sheets[0].cols, [{ at: 1, n: 1 }])
  assert.deepEqual(
    draft.sheets[0].cells.find((c) => c.r === 1 && c.c === 2),
    { r: 1, c: 2, v: 'A', o: 'a' },
    '列号是插列以后的，改之前的值按新位置取',
  )
  assert.equal(draftCount(draft), 3)
})

test('文件没变：原样恢复，和原来的改动一模一样，一步就能撤销', () => {
  const d = doc(BASE)
  let e = rowOpIn(noEdits(), d.sheets[0], { at: 3, n: 1 })
  e = setCellsIn(e, d.sheets[0], [
    { r: 3, c: 0, v: '3' },
    { r: 2, c: 2, v: '25' },
  ])
  const draft = draftOf('p', d, e)!
  const plan = planRestore(draft, d)
  assert.equal(plan.moved, false)
  const back = restoreEdits(draft, d)
  assert.deepEqual(rowsOf(back, d.sheets[0]), rowsOf(e, d.sheets[0]))
  assert.deepEqual(pendingOf(back, d.sheets), pendingOf(e, d.sheets))
  assert.deepEqual(rowsOf(undoIn(back), d.sheets[0]), BASE)
})

test('文件在外面改过、草稿只改了格子：没被动过的格子直接放回，两边都改了的算冲突，可选用哪边', () => {
  const d = doc(BASE)
  const e = setCellsIn(noEdits(), d.sheets[0], [
    { r: 1, c: 1, v: 'A' },
    { r: 2, c: 2, v: '25' },
    { r: 2, c: 1, v: 'B' },
  ])
  const draft = draftOf('p', d, e)!
  const now = doc(
    [
      ['ID', 'Name', 'Price'],
      ['1', 'a', '10'],
      ['2', 'B', '30'],
    ],
    't2',
  )
  const plan = planRestore(draft, now)
  assert.equal(plan.moved, true)
  // (1,1) 文件里没变：放回；(2,1) 文件里已经是我要的 B：不算冲突；(2,2) 文件改成 30、我改成 25：冲突
  assert.equal(plan.clean, 2)
  assert.deepEqual(plan.conflicts, [{ sheet: 'S', r: 2, c: 2, file: '30', mine: '25' }])
  assert.equal(rowsOf(restoreEdits(draft, now, 'mine'), now.sheets[0])[2][2], '25')
  const keepFile = restoreEdits(draft, now, 'file')
  assert.equal(rowsOf(keepFile, now.sheets[0])[2][2], '30')
  assert.equal(rowsOf(keepFile, now.sheets[0])[1][1], 'A')
})

test('文件在外面改过、草稿插删过行列：标成对不上，仍可按原位置放回；没了的工作表列出来', () => {
  const d = doc(BASE)
  const e = rowOpIn(noEdits(), d.sheets[0], { at: 1, n: -1 })
  const draft = draftOf('p', d, e)!
  const now: TableDoc = { ...doc(BASE, 't2'), sheets: [{ name: 'Other', rows: BASE }] }
  const plan = planRestore(draft, now)
  assert.equal(plan.structural, true)
  assert.deepEqual(plan.missing, ['S'])
  assert.equal(planRestore(draft, doc([...BASE, ['3']], 't2')).structural, true)
})
