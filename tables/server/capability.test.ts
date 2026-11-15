/** 表格的项目能力（插件接口 9）：按目录推荐、没设表格目录时说还缺什么 */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { detectTables, tablesReady } from './capability.ts'

const root = await mkdtemp(path.join(os.tmpdir(), 'tables-detect-'))
after(() => rm(root, { recursive: true, force: true }))

test('目录里有 xlsx / csv 才推荐，Excel 的临时锁文件不算', async () => {
  assert.equal(await detectTables({ path: root }), undefined)
  await mkdir(path.join(root, 'Config', 'Tables'), { recursive: true })
  await writeFile(path.join(root, 'Config', 'Tables', '~$Item.xlsx'), '')
  assert.equal(await detectTables({ path: root }), undefined)
  await writeFile(path.join(root, 'Config', 'Tables', 'Item.xlsx'), '')
  await writeFile(path.join(root, 'Config', 'Tables', 'Skill.csv'), '')
  assert.match((await detectTables({ path: root })) ?? '', /2/)
})

test('没设表格目录时说还要选', () => {
  assert.ok(tablesReady({}))
  assert.equal(tablesReady({ plugins: { tables: { dirs: ['Config'] } } }), undefined)
})
