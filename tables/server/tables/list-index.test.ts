/** 表格文件列表的索引：第一次现扫并存盘，下次先给存下的（scanning）、后台扫完推增量并写回；新建后等新扫的结果 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TablesConfig } from '../../shared/tables.ts'
import { TABLES_LIST_EVENT, type TablesListDelta } from '../../shared/table-list.ts'
import { forgetLists, listTables, setListStore } from './list-index.ts'

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tables-list-index-'))
  const data = mkdtempSync(path.join(tmpdir(), 'tables-list-data-'))
  const put = (rel: string) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), 'a,b\n')
  }
  const pushed: { event: string; data: TablesListDelta }[] = []
  const pages = {
    push: (event: string, data: unknown) => {
      pushed.push({ event, data: data as TablesListDelta })
      return 1
    },
    open: () => true,
    onClose: () => () => {},
  }
  setListStore({ dir: data, pages: pages as never })
  return { dir, data, put, pushed }
}

const cfg = TablesConfig.parse({ dirs: ['T'] })
const waitFor = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10))
  assert.ok(ok(), '等后台扫描超时')
}

test('有索引时先给存下的，后台扫完推增量；新建之后等新扫的结果', async () => {
  const { dir, data, put, pushed } = setup()
  put('T/a.csv')
  put('T/sub/b.csv')
  const first = await listTables(dir, cfg, false, 0)
  assert.deepEqual(
    first.files.map((f) => f.path),
    ['T/a.csv', 'T/sub/b.csv'],
  )
  assert.equal(first.scanning, undefined)
  assert.ok(first.key)

  // 插件重启：内存没了，从索引文件读
  setListStore({
    dir: data,
    pages: {
      push: (e: string, d: unknown) => (pushed.push({ event: e, data: d as TablesListDelta }), 1),
      open: () => true,
      onClose: () => () => {},
    } as never,
  })
  await new Promise((r) => setTimeout(r, 20))
  put('T/c.csv')
  rmSync(path.join(dir, 'T/a.csv'))
  const cached = await listTables(dir, cfg, false, 0)
  assert.equal(cached.scanning, true)
  assert.deepEqual(
    cached.files.map((f) => f.path),
    ['T/a.csv', 'T/sub/b.csv'],
  )
  await waitFor(() => pushed.length > 0)
  const d = pushed[0]
  assert.equal(d.event, TABLES_LIST_EVENT)
  assert.ok(!('reload' in d.data))
  assert.equal(d.data.key, cached.key)
  assert.deepEqual(
    d.data.add.map((f) => f.path),
    ['T/c.csv'],
  )
  assert.deepEqual(d.data.remove, ['T/a.csv'])

  // 新建表格后：下次取列表要等重新扫完，不能给旧的
  put('T/d.csv')
  forgetLists()
  const after = await listTables(dir, cfg, false, 60_000)
  assert.equal(after.scanning, undefined)
  assert.ok(after.files.some((f) => f.path === 'T/d.csv'))
  setListStore(undefined)
})
