/** 面板文件弹窗来问的「这个表格文件归不归表格页」：和文件列表同一套目录、包含 / 排除规则，独立分支里的副本不算同一个文件 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TablesConfig } from '../../shared/tables.ts'
import { claimTableFile } from './claim.ts'

const base = mkdtempSync(path.join(tmpdir(), 'agent-panel-claim-'))
const dir = path.join(base, 'proj')
const out = path.join(base, 'shared-tables')
const wt = path.join(base, 'wt')
const cfg = (p: Partial<TablesConfig> = {}) => TablesConfig.parse({ dirs: ['Config', out], ...p })

test('项目表格目录里的：给相对路径，同一个文件', () => {
  assert.deepEqual(claimTableFile(dir, cfg(), path.join(dir, 'Config/sub/Item.xlsx')), {
    rel: 'Config/sub/Item.xlsx',
    same: true,
  })
  assert.deepEqual(claimTableFile(dir, cfg(), path.join(dir, 'Config/Skill.CSV')).rel, 'Config/Skill.CSV')
})

test('项目目录外的表格目录：给正斜杠的绝对路径', () => {
  const f = path.join(out, 'Hero.xlsx')
  assert.deepEqual(claimTableFile(dir, cfg(), f), { rel: f.replace(/\\/g, '/'), same: true })
})

test('独立分支里的副本：按分支里的相对路径认，但不是同一个文件', () => {
  assert.deepEqual(claimTableFile(dir, cfg(), path.join(wt, 'Config/Item.xlsx'), wt), {
    rel: 'Config/Item.xlsx',
    same: false,
  })
})

test('不认：表格目录外、不是表格、锁文件、排除的目录、跳过的目录、没开表格功能、相对路径', () => {
  const no = (f: string, c = cfg(), root?: string) => assert.equal(claimTableFile(dir, c, f, root).rel, null, f)
  no(path.join(dir, 'Other/Out.csv'))
  no(path.join(dir, 'Config/readme.md'))
  no(path.join(dir, 'Config/~$Item.xlsx'))
  no(path.join(dir, 'Config/node_modules/x.csv'))
  no(path.join(dir, 'Config/Old/Item.xlsx'), cfg({ exclude: 'Config/Old' }))
  no(path.join(dir, 'Config/Item.xlsx'), cfg({ include: '*.csv' }))
  no(path.join(dir, 'Config/Item.xlsx'), cfg({ dirs: [] }))
  no(path.join(base, 'elsewhere/Item.xlsx'), cfg(), wt)
  no('Config/Item.xlsx')
})
