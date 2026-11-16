/** AI 分析的样本：全项目表头固定取值的统计 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TableFile } from '../../shared/tables.ts'
import { headerValues } from './sample.ts'

test('统计多张表表头里修饰、导出端出现过的值，样本没见到的少见取值也在里面', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-panel-sample-'))
  writeFileSync(
    path.join(dir, 'A.csv'),
    'optional,optional,repeated\nClient,Server,Client\nuint32,string,int32\nID,Name,List\nid,名字,列表\n1,a,1#2\n',
  )
  writeFileSync(path.join(dir, 'B.csv'), 'optional,optional\nClient,Public\nuint32,string\nID,Name\nid,名\n1,a\n')
  const files: TableFile[] = ['A.csv', 'B.csv'].map((p) => ({ path: p, kind: 'csv', size: 0, mtime: '' }))
  const text = await headerValues(dir, files)
  assert.match(text, /看了 2 张表/)
  assert.match(text, /Public（1）/)
  assert.match(text, /repeated（1）/)
})
