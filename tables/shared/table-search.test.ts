/** 跨表搜索的匹配规则：「字段名:值」、三个开关、数组列整项匹配、替换、结果片段的高亮位置 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cellMatcher, hitSnippet, parseSearchQuery } from './table-search.ts'

test('「字段名:值」：像字段名的前缀才算，带冒号的值照常整串找', () => {
  assert.deepEqual(parseSearchQuery(' ItemId:1001 '), { field: 'ItemId', text: '1001' })
  assert.deepEqual(parseSearchQuery('物品ID：剑'), { field: '物品ID', text: '剑' })
  assert.deepEqual(parseSearchQuery('Name: 木 剑'), { field: 'Name', text: '木 剑' })
  assert.deepEqual(parseSearchQuery('12:30'), { text: '12:30' })
  assert.deepEqual(parseSearchQuery('C:\\Game'), { field: 'C', text: '\\Game' })
  // 只写了字段名还没写值：先按整串找
  assert.deepEqual(parseSearchQuery('ItemId:'), { text: 'ItemId:' })
  assert.deepEqual(parseSearchQuery('a b:c'), { text: 'a b:c' })
})

test('匹配：默认不分大小写的子串；区分大小写、整格、正则', () => {
  assert.deepEqual(cellMatcher('sword', {}).find('Iron Sword'), [5, 10])
  assert.equal(cellMatcher('sword', { caseSensitive: true }).find('Iron Sword'), null)
  assert.equal(cellMatcher('100', { whole: true }).find('1001'), null)
  assert.deepEqual(cellMatcher('1001', { whole: true }).find('1001'), [0, 4])
  assert.deepEqual(cellMatcher('^\\d+$', { regex: true }).find('42'), [0, 2])
  assert.throws(() => cellMatcher('(', { regex: true }), /正则/)
})

test('整格匹配：数组列里某一项整项相同也算，替换只换那一项', () => {
  const m = cellMatcher('1001', { whole: true }, ';')
  assert.deepEqual(m.find('1000;1001;10010'), [5, 9])
  assert.equal(m.find('10010;2'), null)
  assert.equal(m.replace('1000; 1001;10010', '2001'), '1000; 2001;10010')
  assert.equal(m.replace('1001', '2001'), '2001')
})

test('替换：普通模式 $ 不当引用，正则模式能用 $1', () => {
  assert.equal(cellMatcher('剑', {}).replace('木剑·剑', '$&刀'), '木$&刀·$&刀')
  assert.equal(cellMatcher('(\\w+)_old', { regex: true }).replace('Item_old', '$1_new'), 'Item_new')
})

test('结果片段：长格子把命中露出来，高亮位置跟着平移', () => {
  const v = `${'a'.repeat(300)}剑${'b'.repeat(300)}`
  const s = hitSnippet(v, [300, 301], 100)
  assert.equal(s.text.slice(s.at[0], s.at[1]), '剑')
  assert.ok(s.text.startsWith('…') && s.text.endsWith('…'))
  assert.deepEqual(hitSnippet('短', [0, 1]), { text: '短', at: [0, 1] })
})
