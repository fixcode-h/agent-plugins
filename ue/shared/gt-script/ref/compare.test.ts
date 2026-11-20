// 比较表（kind → op）和协议 game-test-ref.md 第 3.4 节的表格一字不差：面板和 C++ 的 FGameTestCompareRegistry 同名同表。
// 协议在 UEKit 仓库：默认找本仓库旁边的 ../uekit，或环境变量 UEKIT_DIR；都找不到时跳过表格核对（只跑本地的几条）。
// 用法：node --test ue/shared/gt-script/ref/compare.test.ts
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { compareKinds, defaultOpFor, implicitOp, opDef, opsFor } from './compare/index.ts'
import type { GtPropKind } from './types.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const DOC = [
  process.env.UEKIT_DIR && path.join(process.env.UEKIT_DIR, 'docs', 'game-test-ref.md'),
  path.resolve(here, '../../../../../uekit/docs/game-test-ref.md'),
].find((f): f is string => !!f && existsSync(f))

/**
 * 读 3.4 节的表格：第一列 kind（可以几个，用 / 分开），第三列 op。第三列里全角括号是说明（不算 op），
 * 「同 `string`」「enum 的全部」是引用别的行，「不能」开头的是不能比较的类
 */
function tableFromDoc(text: string): Map<GtPropKind, string[]> {
  const sec = text.slice(text.indexOf('### 3.4'), text.indexOf('Lua 值的 kind'))
  const rows = sec.split('\n').filter((l) => /^\|\s*`/.test(l))
  const out = new Map<GtPropKind, string[]>()
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim())
    const kinds = [...cells[1].matchAll(/`(\w+)`/g)].map((m) => m[1] as GtPropKind)
    let opsText = cells[3]
    if (/^不能/.test(opsText)) {
      for (const k of kinds) out.set(k, [])
      continue
    }
    opsText = opsText.replace(/（[^）]*）/g, ' ')
    const ops: string[] = []
    const same = /同 `(\w+)`/.exec(opsText) ?? /(\w+) 的全部/.exec(opsText)
    if (same) {
      ops.push(...(out.get(same[1] as GtPropKind) ?? []))
      opsText = opsText.replace(same[0], ' ')
    }
    for (const m of opsText.matchAll(/`(\w+)`/g)) ops.push(m[1])
    for (const k of kinds) out.set(k, ops)
  }
  return out
}

test('比较表和协议 3.4 节的表格一致', { skip: !DOC && '找不到 UEKit 的 docs/game-test-ref.md' }, () => {
  const doc = tableFromDoc(readFileSync(DOC!, 'utf8'))
  assert.ok(doc.size >= 16, `表格只读到 ${doc.size} 行`)
  for (const [kind, ops] of doc) assert.deepEqual(opsFor(kind), ops, kind)
  assert.deepEqual(new Set(compareKinds()), new Set(doc.keys()), '面板注册的 kind 和协议的一样多')
})

test('值的形状和默认 op', () => {
  assert.equal(opDef('int', 'between')?.value, 'pair')
  assert.equal(opDef('string', 'in')?.value, 'list')
  assert.equal(opDef('visibility', 'visible')?.value, 'none')
  assert.equal(opDef('array', 'count')?.value, 'count')
  assert.equal(opDef('vector', 'near')?.tol, true)
  assert.equal(defaultOpFor('bool'), 'is')
  assert.equal(defaultOpFor('visibility'), 'visible')
  assert.equal(defaultOpFor('struct'), undefined)
  // 省略 op：bool 按真值（is），其余 eq（enum 没有 eq，省略就是写错，校验报 op_type）
  assert.equal(implicitOp('bool'), 'is')
  assert.equal(implicitOp('enum'), 'eq')
  assert.ok(!opsFor('enum').includes('eq'))
  assert.ok(opsFor('text').includes('key') && !opsFor('string').includes('key'))
})
