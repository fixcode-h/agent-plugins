/** 外部改动检测：fs.watch 盯目录，按连接推给登记了的页面；改名替换（Excel 的保存方式）也认得出 */
import assert from 'node:assert/strict'
import { mkdtempSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { tableWatcher, type FileChanged } from './watch.ts'

const dir = mkdtempSync(path.join(tmpdir(), 'tb-watch-'))
after(() => rmSync(dir, { recursive: true, force: true }))

function fakePages(open: string[]) {
  const sent: { event: string; data: FileChanged; to: string[] }[] = []
  let closer: ((conn: string) => void) | undefined
  return {
    sent,
    close: (conn: string) => closer?.(conn),
    pages: {
      push: (event: string, data: unknown, to?: string | Iterable<string>) => {
        sent.push({ event, data: data as FileChanged, to: typeof to === 'string' ? [to] : [...(to ?? [])] })
        return 1
      },
      open: (conn: string) => open.includes(conn),
      onClose: (fn: (conn: string) => void) => {
        closer = fn
        return () => (closer = undefined)
      },
    },
  }
}

/** 等到推了 n 条（fs.watch 和防抖都是异步的），最多等 3 秒 */
async function until(f: () => boolean) {
  for (let i = 0; i < 60 && !f(); i++) await new Promise((r) => setTimeout(r, 50))
}

test('改了打开着的文件：推给登记了的页面，同一次改动只推一次', async () => {
  const full = path.join(dir, 'item.xlsx')
  writeFileSync(full, 'a')
  const old = new Date(Date.now() - 60_000)
  utimesSync(full, old, old)
  const p = fakePages(['c1', 'c2'])
  const w = tableWatcher(p.pages)
  w.set('c1', 'p1', [{ full, rel: 'Tables/item.xlsx', mtime: old.toISOString() }])
  w.set('c2', 'p1', [{ full, rel: 'Tables/item.xlsx', mtime: old.toISOString() }])
  // 没登记的连接不收
  assert.deepEqual(w.set('gone', 'p1', [{ full, rel: 'x', mtime: '' }]), { watching: 0 })
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(p.sent.length, 0)
  // Excel / WPS 的保存：写临时文件再改名替换
  writeFileSync(path.join(dir, '~tmp1'), 'b')
  renameSync(path.join(dir, '~tmp1'), full)
  await until(() => p.sent.length > 0)
  await new Promise((r) => setTimeout(r, 500))
  assert.equal(p.sent.length, 1)
  assert.equal(p.sent[0].event, 'file-changed')
  assert.equal(p.sent[0].data.path, 'Tables/item.xlsx')
  assert.equal(p.sent[0].data.projectId, 'p1')
  assert.ok(p.sent[0].data.mtime)
  assert.deepEqual(p.sent[0].to.sort(), ['c1', 'c2'])
  w.close()
})

test('自己保存的不推；页面关了清掉登记、没人盯的目录关掉', async () => {
  const full = path.join(dir, 'skill.csv')
  writeFileSync(full, 'a')
  const p = fakePages(['c1'])
  const w = tableWatcher(p.pages)
  w.set('c1', 'p1', [{ full, rel: 'skill.csv', mtime: new Date(0).toISOString() }])
  // 登记时页面给的修改时间对不上（登记前就被改了）：马上推一次
  await until(() => p.sent.length > 0)
  assert.equal(p.sent.length, 1)
  writeFileSync(full, 'b')
  // 和保存接口一样按 stat 的 mtime（Date）记
  w.saw(full, statSync(full).mtime.toISOString())
  await new Promise((r) => setTimeout(r, 600))
  assert.equal(p.sent.length, 1)
  assert.deepEqual(w.size(), { dirs: 1, files: 1 })
  p.close('c1')
  assert.deepEqual(w.size(), { dirs: 0, files: 0 })
  w.close()
})

test('整份替换：不再打开的文件不盯了，别的项目的登记不动', () => {
  const a = path.join(dir, 'a.csv')
  const b = path.join(dir, 'b.csv')
  writeFileSync(a, '1')
  writeFileSync(b, '1')
  const p = fakePages(['c1'])
  const w = tableWatcher(p.pages)
  const now = new Date().toISOString()
  w.set('c1', 'p1', [
    { full: a, rel: 'a.csv', mtime: now },
    { full: b, rel: 'b.csv', mtime: now },
  ])
  w.set('c1', 'p2', [{ full: b, rel: 'b.csv', mtime: now }])
  assert.equal(w.size().files, 2)
  w.set('c1', 'p1', [])
  // b 还在 p2 里开着
  assert.equal(w.size().files, 1)
  w.set('c1', 'p2', [])
  assert.deepEqual(w.size(), { dirs: 0, files: 0 })
  w.close()
})
