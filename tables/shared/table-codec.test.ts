/** 类型表和格子文字的来回换：存储样式拆值、显示样式拼字、拼回格子、检查叶子 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TableSchema } from './tables.ts'
import { ueTypes } from './table-types-ue.ts'
import { formatShow, formatStore, parseStore, storeToShow, tplIssues, typeNode, type Codec } from './table-codec.ts'
import { checkCell, columnInfos } from './table-struct.ts'
import { ruleOf } from './table-header.ts'
import { toSheetHeader } from './table-header.ts'

const schema = (extra: object = {}) =>
  TableSchema.parse({
    types: {
      ...ueTypes(),
      FVector: {
        kind: 'struct',
        store: '{X}#{Y}#{Z}',
        fields: [
          { name: 'X', type: 'double' },
          { name: 'Y', type: 'double' },
          { name: 'Z', type: 'double' },
        ],
      },
      Reward: {
        kind: 'struct',
        store: '{ItemID}:{Count}',
        fields: [
          { name: 'ItemID', type: 'int32' },
          { name: 'Count', type: 'int32', min: 1 },
        ],
      },
      ItemList: { kind: 'alias', of: 'TArray<int32>' },
    },
    ...extra,
  })

test('FVector 按存储模板 {X}#{Y}#{Z} 拆，显示成 UE 的写法，拼回去不变', () => {
  const s = schema()
  const n = typeNode(s, 'FVector')
  const c: Codec = { formats: s.style.formats, listSep: ';' }
  const p = parseStore(n, '1#2#3', c)
  assert.ok(p.ok)
  assert.deepEqual(p.ok && p.v, { f: { X: '1', Y: '2', Z: '3' } })
  assert.equal(storeToShow(n, '1#2#3', c), '(X=1,Y=2,Z=3)')
  assert.equal(p.ok && formatStore(n, p.v, c), '1#2#3')
  // 拆不开：原样显示
  assert.equal(storeToShow(n, '1,2,3', c), '1,2,3')
})

test('数组套结构体、映射、集合、别名', () => {
  const s = schema()
  const c: Codec = { formats: s.style.formats, listSep: ';' }
  const arr = typeNode(s, 'TArray<Reward>')
  assert.equal(storeToShow(arr, '1001:2;1002:5', c), '((ItemID=1001,Count=2),(ItemID=1002,Count=5))')
  const map = typeNode(s, 'TMap<FName, int32>')
  assert.equal(storeToShow(map, 'A:1;B:2', c), '((A, 1),(B, 2))')
  const dup = parseStore(map, 'A:1;A:2', c)
  assert.ok(!dup.ok && /重复/.test(dup.err))
  const set = parseStore(typeNode(s, 'TSet<int32>'), '1;1', c)
  assert.ok(!set.ok)
  assert.equal(typeNode(s, 'ItemList').k, 'list')
  // 数组里套数组：第二层用 |
  const nested = typeNode(s, 'TArray<TArray<int32>>')
  const p = parseStore(nested, '1|2;3', c)
  assert.ok(p.ok)
  assert.equal(p.ok && formatShow(nested, p.v, s.style.formats), '((1,2),(3))')
})

test('UE 预设：FColor 存 R,G,B,A、显示 UE 的 B G R A；可选字段省略时按默认值显示', () => {
  const s = schema()
  const c: Codec = { formats: s.style.formats, listSep: ';' }
  const n = typeNode(s, 'Color')
  assert.equal(storeToShow(n, '255,128,0', c), '(B=0,G=128,R=255,A=255)')
  const tags = typeNode(s, 'FGameplayTagContainer')
  assert.equal(storeToShow(tags, 'A.B;C', c), '(GameplayTags=((TagName="A.B"),(TagName="C")))')
  const tf = typeNode(s, 'FTransform')
  assert.ok(parseStore(tf, '0,0,0,1|1#2#3|1#1#1', c).ok)
})

test('模板检查：不是字段、漏了必填、两个占位挨着', () => {
  const fields = [{ name: 'X' }, { name: 'Y' }, { name: 'Z', optional: true }]
  assert.deepEqual(tplIssues('{X},{Y}', fields), [])
  assert.equal(tplIssues('{X}{Y}', fields).length, 1)
  assert.equal(tplIssues('{X},{W}', fields).length, 2)
})

test('检查：拆不开、叶子超范围、枚举都带位置', () => {
  const s = schema({ enums: { Kind: { values: [{ name: 'A' }] } } })
  const rows = [
    ['Rewards', 'Pos', 'Kinds'],
    ['TArray<Reward>', 'FVector', 'TMap<Kind,int32>'],
    ['1001:0', '1#x#3', 'B:1'],
  ]
  const header = toSheetHeader(ruleOf(['name', 'type']))
  const infos = columnInfos(s, rows, header, 'a.xlsx', 'Sheet1', 3)
  assert.equal(infos[0].kind, 'struct')
  const ctx = { listSep: ';', enums: new Map([['Kind', new Set(['A'])]]), refs: new Map() }
  assert.match(checkCell(infos[0], rows[2][0], ctx) ?? '', /第 1 项 · Count/)
  assert.match(checkCell(infos[1], rows[2][1], ctx) ?? '', /^Y/)
  assert.match(checkCell(infos[2], rows[2][2], ctx) ?? '', /键/)
  assert.equal(checkCell(infos[0], '1001:1;1002:3', ctx), undefined)
})
