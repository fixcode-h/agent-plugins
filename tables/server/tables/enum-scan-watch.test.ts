/** 枚举扫描「盯着改动」：按规则开目录、跳过 .git 这类目录的事件、规则改了重新同步、关掉 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { FSWatcher } from 'node:fs'
import { test } from 'node:test'
import { EnumScan } from '../../shared/table-enum-scan.ts'
import { TableSchema, TablesConfig } from '../../shared/tables.ts'
import { enumScanWatcher, ignoredChange } from './enum-scan-watch.ts'

test('跳过的目录', () => {
  assert.equal(ignoredChange('Source/A.h'), false)
  assert.equal(ignoredChange('.git/index'), true)
  assert.equal(ignoredChange('Source/Intermediate/x.h'), true)
  assert.equal(ignoredChange('.agentpanel/tables/enum-scan-results.json'), true)
})

test('按 watch 规则开目录，改了就扫、推给页面；规则关掉就收', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'scan-watch-'))
  mkdirSync(path.join(dir, 'Source/Enums'), { recursive: true })
  writeFileSync(path.join(dir, 'Source/Enums/A.h'), 'enum class EA { X, Y };')
  const schemaAt = path.join(dir, '.agentpanel/tables')
  mkdirSync(schemaAt, { recursive: true })
  const rule = EnumScan.parse({ id: 's1', from: { kind: 'cpp', files: 'Source/Enums/**/*.h' }, auto: 'watch' })
  let schema = TableSchema.parse({ scans: [rule] })
  const cbs = new Map<string, (f: string) => void>()
  const pushed: unknown[] = []
  const w = enumScanWatcher({
    pages: { push: (ev: string, data: unknown) => void pushed.push({ ev, data }) } as never,
    ctxOf: async () => ({ dir, cfg: TablesConfig.parse({}), schemaAt, schema }),
    projectIds: async () => ['p1'],
    watchFn: (d, on) => {
      cbs.set(d, on)
      const e = new EventEmitter() as unknown as FSWatcher
      ;(e as unknown as { close: () => void }).close = () => cbs.delete(d)
      return e
    },
    log: () => undefined,
  })
  await w.syncAll()
  assert.deepEqual(w.roots('p1'), [path.join(dir, 'Source/Enums')])

  cbs.get(path.join(dir, 'Source/Enums'))!('A.h')
  await new Promise((r) => setTimeout(r, 1800))
  assert.equal(pushed.length, 1)
  const d = (pushed[0] as { data: { runs: { id: string }[] } }).data
  assert.equal(d.runs[0].id, 's1')

  // 没变：不推
  cbs.get(path.join(dir, 'Source/Enums'))!('A.h')
  await new Promise((r) => setTimeout(r, 1800))
  assert.equal(pushed.length, 1)

  schema = TableSchema.parse({ scans: [{ ...rule, auto: 'open' }] })
  await w.sync('p1')
  assert.deepEqual(w.roots('p1'), [])
  assert.equal(cbs.size, 0)
  w.close()
})

test('Linux 逐目录盯：文件被改名替换（sed -i、编辑器保存）之后再改照样有事件，新建子目录也盯上', async (t) => {
  if (process.platform !== 'linux') return t.skip('只在 Linux 上用')
  const { renameSync } = await import('node:fs')
  const { treeWatch } = await import('./enum-scan-watch.ts')
  const dir = mkdtempSync(path.join(tmpdir(), 'tree-watch-'))
  mkdirSync(path.join(dir, 'a'))
  writeFileSync(path.join(dir, 'a/f.h'), '1')
  const seen: string[] = []
  const w = treeWatch(dir, (f) => seen.push(f))
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  await wait(200)
  writeFileSync(path.join(dir, 'a/tmp'), '2')
  renameSync(path.join(dir, 'a/tmp'), path.join(dir, 'a/f.h'))
  await wait(200)
  seen.length = 0
  writeFileSync(path.join(dir, 'a/f.h'), '3')
  await wait(200)
  assert.ok(seen.includes(path.join('a', 'f.h')), seen.join(','))
  mkdirSync(path.join(dir, 'a/new'))
  await wait(200)
  seen.length = 0
  writeFileSync(path.join(dir, 'a/new/g.h'), '4')
  await wait(200)
  assert.ok(seen.includes(path.join('a', 'new', 'g.h')), seen.join(','))
  w.close()
})
