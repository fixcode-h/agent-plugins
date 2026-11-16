/** 存进项目的分析结果：只认更新的，内容没变不写 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TablesDraft } from '../../shared/tables-assist.ts'
import { readAnalysis, writeAnalysis } from './analysis-store.ts'

test('新的覆盖旧的，旧的不盖新的', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-panel-analysis-'))
  assert.equal(await readAnalysis(dir), null)
  const draft = TablesDraft.parse({ summary: '新' })
  await writeAnalysis(dir, { at: '2026-11-16T03:00:00Z', messageId: 'b', draft })
  const kept = await writeAnalysis(dir, {
    at: '2026-11-16T02:00:00Z',
    messageId: 'a',
    draft: TablesDraft.parse({ summary: '旧' }),
  })
  assert.equal(kept.messageId, 'b')
  assert.equal((await readAnalysis(dir))?.draft.summary, '新')
  const before = statSync(path.join(dir, 'analysis.json')).mtimeMs
  await writeAnalysis(dir, { at: '2026-11-16T03:00:00Z', messageId: 'b', draft })
  assert.equal(statSync(path.join(dir, 'analysis.json')).mtimeMs, before)
})
