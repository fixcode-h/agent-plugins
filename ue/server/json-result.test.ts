// Agent 结果统一出口（json-result.ts）：紧凑 JSON + structuredContent，超长按列表截短仍是合法 JSON，提示写进对象。
// 用法（在 ue/ 下）：AGENT_PLUGIN_PANEL=../.panel AGENT_PLUGIN_DIR=. node --import ../scripts/lib/panel-register.mjs --test server/json-result.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fitJson, jsonResult, withTip } from './json-result.ts'

const text = (r: { content: { type: string; text?: string }[] }) => r.content[0].text ?? ''

test('对象：紧凑 JSON 一个 text 块，带同一份 structuredContent；字符串、数组照旧不带', () => {
  const r = jsonResult({ a: 1, b: ['x'] })
  assert.equal(text(r), '{"a":1,"b":["x"]}')
  assert.deepEqual(r.structuredContent, { a: 1, b: ['x'] })
  assert.equal(jsonResult('已停止').structuredContent, undefined)
  assert.equal(jsonResult([1, 2]).structuredContent, undefined)
})

test('超长：截最大的列表，结果仍能解析，clipped 写明列了几个、一共几个', () => {
  const data = { name: 'BP', items: Array.from({ length: 2000 }, (_, i) => ({ path: `/Game/A/Item_${i}`, n: i })) }
  const r = jsonResult(data, 4000)
  const s = text(r)
  assert.ok(s.length <= 4000, `长度 ${s.length}`)
  const back = JSON.parse(s)
  assert.equal(back.name, 'BP')
  assert.ok(back.items.length > 1 && back.items.length < 2000)
  assert.deepEqual(back.clipped.lists, [{ path: 'items', shown: back.items.length, total: 2000 }])
  assert.deepEqual(r.structuredContent, back)
})

test('顶层是数组时超长：包成 items 再截；单个超长字符串截不动就退回文字截断', () => {
  const back = fitJson(
    Array.from({ length: 1000 }, (_, i) => `row-${i}`),
    2000,
  ) as { items: string[]; clipped: unknown }
  assert.ok(back.items.length < 1000 && back.clipped)
  const r = jsonResult({ s: 'x'.repeat(5000) }, 1000)
  assert.equal(r.structuredContent, undefined)
  assert.match(text(r), /个字符没列出/)
})

test('追加提示：有结构化结果时写进 tips 并重写文字；没有时追加 text 块', () => {
  const r = withTip(jsonResult({ ok: true }), '\n\n提示：改用 select')
  assert.deepEqual(r.structuredContent, { ok: true, tips: ['提示：改用 select'] })
  assert.equal(r.content.length, 1)
  assert.deepEqual(JSON.parse(text(r)), r.structuredContent)
  const plain = withTip(jsonResult('完成'), '提示')
  assert.equal(plain.content.length, 2)
})
