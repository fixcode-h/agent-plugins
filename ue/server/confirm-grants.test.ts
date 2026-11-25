import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

// 确认卡都要带规则键（用户 2026-11-25：执行 Lua 的卡漏了「本对话不再询问」）：直接把字面量交给 confirm / ask 的写法拦下，
// 要走 withGrant / dangerGrant，或像 self-test-gate.ts 那样自己写 rule
function walk(dir: string, out: string[] = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) walk(f, out)
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(f)
  }
  return out
}

test('确认卡都带规则键', () => {
  const root = path.join(import.meta.dirname, '.')
  const bad: string[] = []
  let seen = 0
  for (const f of walk(root)) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/(?:\.confirm\(|\bask\(ctx,)\s*\{/g)) {
      seen++
      const tail = src.slice(m.index, m.index + 600)
      if (!/\brule:/.test(tail.slice(0, tail.indexOf('})') + 1 || 600))) bad.push(path.relative(root, f))
    }
  }
  assert.deepEqual(bad, [])
  // 正则失效时别悄悄通过：现在至少有游戏内测试授权卡、飞书之外的这几处字面量
  assert.ok(seen >= 1)
})
