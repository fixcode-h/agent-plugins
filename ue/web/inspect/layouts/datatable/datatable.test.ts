// 数据表布局的单测：node --test ue/web/inspect/layouts/datatable/datatable.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { arrayEdit, cellOf, colorOf, getAt, nextSort, refShort, sortRows, stepRow, type TableRow } from './model.ts'

test('单元格按值的样子画', () => {
  assert.deepEqual(cellOf(true, 'bool'), { kind: 'bool', on: true })
  assert.deepEqual(cellOf(2400, 'int32'), { kind: 'num', text: '2,400' })
  assert.deepEqual(cellOf(4.2, 'float'), { kind: 'num', text: '4.20' })
  assert.deepEqual(cellOf(['Weapon', 'Melee'], 'TArray<FName>'), { kind: 'count', n: 2 })
  assert.deepEqual(cellOf({ _truncated: true, _count: 7 }, 'TArray<FName>'), { kind: 'count', n: 7 })
  assert.equal(cellOf('Common', 'EForgeRarity').kind, 'enum')
  assert.deepEqual(cellOf('EForgeRarity::Rare', 'TEnumAsByte<EForgeRarity>'), { kind: 'enum', text: 'Rare' })
  const ref = cellOf('/Game/UI/Icons/T_Icon_Sword.T_Icon_Sword', 'TSoftObjectPtr<UTexture2D>')
  assert.deepEqual(ref, { kind: 'ref', name: 'T_Icon_Sword', path: '/Game/UI/Icons/T_Icon_Sword.T_Icon_Sword' })
  assert.equal(cellOf('None', 'TSoftObjectPtr<UTexture2D>').kind, 'empty')
  assert.equal(cellOf('', 'FText').kind, 'empty')
  assert.deepEqual(cellOf('铁剑', 'FText'), { kind: 'text', text: '铁剑' })
})

test('颜色：线性转 sRGB 十六进制，字段大小写都认', () => {
  assert.equal(colorOf({ r: 1, g: 0, b: 0, a: 1 }, 'FLinearColor')?.hex, '#ff0000')
  assert.equal(colorOf({ R: 0.5, G: 0.5, B: 0.5, A: 1 })?.hex, '#bcbcbc')
  assert.equal(colorOf({ R: 255, G: 128, B: 0, A: 255 }, 'FColor')?.hex, '#ff8000')
  assert.equal(colorOf({ X: 1, Y: 2, Z: 3 }), undefined)
  assert.equal(refShort("Texture2D'/Game/T/T_A.T_A'"), 'T_A')
})

const rows: TableRow[] = [
  { name: 'B', values: { Price: 10, Tags: ['a'] } },
  { name: 'a', values: { Price: 2, Tags: ['a', 'b', 'c'] } },
  { name: 'C', values: { Price: 300, Tags: [] } },
]

test('列头排序：升序 → 降序 → 不排；不改原数组', () => {
  assert.deepEqual(
    sortRows(rows, { col: 'Price', desc: false }).map((r) => r.name),
    ['a', 'B', 'C'],
  )
  assert.deepEqual(
    sortRows(rows, { col: 'Tags', desc: true }).map((r) => r.name),
    ['a', 'B', 'C'],
  )
  assert.deepEqual(
    sortRows(rows, { col: '', desc: false }).map((r) => r.name),
    ['a', 'B', 'C'],
  )
  assert.equal(sortRows(rows, undefined), rows)
  assert.deepEqual(nextSort(undefined, 'Price'), { col: 'Price', desc: false })
  assert.deepEqual(nextSort({ col: 'Price', desc: false }, 'Price'), { col: 'Price', desc: true })
  assert.equal(nextSort({ col: 'Price', desc: true }, 'Price'), undefined)
  assert.deepEqual(nextSort({ col: 'Price', desc: true }, 'Tags'), { col: 'Tags', desc: false })
})

test('上一行 / 下一行', () => {
  assert.equal(stepRow(rows, 'a', 1), 'C')
  assert.equal(stepRow(rows, 'a', -1), 'B')
  assert.equal(stepRow(rows, 'C', 1), undefined)
  assert.equal(stepRow(rows, '', 1), 'B')
})

test('行编辑器的数组按钮：网页算出新数组', () => {
  assert.deepEqual(arrayEdit(['a', 'b'], 'add'), ['a', 'b', ''])
  assert.deepEqual(arrayEdit([1, 2], 'insert', 0), [0, 1, 2])
  assert.deepEqual(arrayEdit([{ x: 1 }], 'duplicate', 0), [{ x: 1 }, { x: 1 }])
  assert.deepEqual(arrayEdit(['a', 'b'], 'remove', 0), ['b'])
  assert.deepEqual(arrayEdit(['a', 'b'], 'clear'), [])
  assert.deepEqual(arrayEdit(['a'], 'remove', 5), ['a'])
  assert.deepEqual(getAt({ Stats: { mods: [{ Value: 3 }] } }, 'Stats.Mods[0].Value'), 3)
  assert.equal(getAt({ A: 1 }, 'B.C'), undefined)
})
