// ue_python 的安全网：入口脚本包事务、事务标题和 UELink 的 asset.undo 对得上、改了哪些包。
// 用法（在仓库根）：node --test ue/server/python-run.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newlyDirty, pythonTxId, pythonWrapper } from './python-run.ts'

test('事务 id 是 8 位小写十六进制（和 UELink FTx 一样）', () => {
  for (let i = 0; i < 20; i++) assert.match(pythonTxId(), /^[0-9a-f]{8}$/)
})

test('入口脚本把代码包进带 AgentPanel <id> 标题的事务，路径换成正斜杠', () => {
  const s = pythonWrapper('C:\\Proj\\Saved\\AgentPanel\\py\\code-1.py', 'ab12cd34')
  assert.match(s, /ScopedEditorTransaction\("AgentPanel ab12cd34: python"\)/)
  assert.match(s, /"C:\/Proj\/Saved\/AgentPanel\/py\/code-1\.py"/)
  assert.ok(!s.includes('\\\\'))
  assert.match(s, /^ {4}exec\(compile\(/m)
})

test('执行后多出来的没保存的包', () => {
  assert.deepEqual(newlyDirty(['/Game/A'], ['/Game/A', '/Game/B', '/Game/C']), ['/Game/B', '/Game/C'])
  assert.deepEqual(newlyDirty(['/Game/A'], []), [])
})
