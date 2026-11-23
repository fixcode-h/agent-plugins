import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, renameSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { LogTail } from './tail.ts'

const L = (s: string, i: number) => `[2026.11.23-10.00.${String(i).padStart(2, '0')}:000][  0]${s}\n`

test('增量读取：只给游标之后的新条目；多行消息并成一条；计数按读到的算', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'logtail-'))
  const f = path.join(dir, 'Game.log')
  writeFileSync(f, L('LogInit: Display: start', 1) + L('LogTemp: Error: boom', 2) + 'stack line 1\nstack line 2\n')
  const t = new LogTail(f)
  assert.equal(await t.refresh(), true)
  const a = t.since(0, undefined, 100)
  assert.equal(a.reset, true)
  assert.equal(a.lines.length, 2)
  assert.equal(a.lines[1].text, 'boom\nstack line 1\nstack line 2')
  assert.equal(t.errors, 1)
  // 没写新内容：没有变化，游标之后为空
  assert.equal(await t.refresh(), false)
  assert.deepEqual(t.since(a.cursor, a.epoch, 100).lines, [])
  appendFileSync(f, L('LogTemp: Warning: careful', 3))
  assert.equal(await t.refresh(), true)
  const b = t.since(a.cursor, a.epoch, 100)
  assert.equal(b.reset, false)
  assert.deepEqual(
    b.lines.map((l) => l.text),
    ['careful'],
  )
  assert.equal(t.warnings, 1)
})

test('换了文件（UE 启动时改名旧日志）或被清空：epoch 变，拿旧游标来取时整份换掉', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'logtail-'))
  const f = path.join(dir, 'Game.log')
  writeFileSync(f, L('LogInit: old', 1) + L('LogInit: old2', 2))
  const t = new LogTail(f)
  await t.refresh()
  const a = t.since(0, undefined, 100)
  renameSync(f, path.join(dir, 'Game-backup.log'))
  writeFileSync(f, L('LogInit: new', 1))
  await t.refresh()
  const b = t.since(a.cursor, a.epoch, 100)
  assert.equal(b.reset, true)
  assert.deepEqual(
    b.lines.map((l) => l.text),
    ['new'],
  )
  truncateSync(f, 0)
  await t.refresh()
  const c = t.since(b.cursor, b.epoch, 100)
  assert.equal(c.reset, true)
  assert.equal(c.lines.length, 0)
  assert.equal(t.errors + t.warnings, 0)
})

test('文件很大：第一次只读尾部 initBytes，丢掉开头的半行', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'logtail-'))
  const f = path.join(dir, 'Game.log')
  let s = ''
  for (let i = 0; i < 200; i++) s += L(`LogTemp: line ${i}`, i % 60)
  writeFileSync(f, s)
  const t = new LogTail(f, { initBytes: 1000 })
  await t.refresh()
  const got = t.since(0, undefined, 1000).lines
  assert.ok(got.length > 5 && got.length < 30)
  assert.equal(got[got.length - 1].text, 'line 199')
  assert.ok(got.every((l) => l.category === 'LogTemp'))
})
