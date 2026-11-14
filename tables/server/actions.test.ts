/**
 * Agent 的表格动作：经表格页同一套接口查行、按主键改格子、末尾加行；结构检查不过时不写。
 * 用真实的表格接口（挂在面板给插件的 /api/plugins/tables/api/ 下）和临时目录里的 CSV（数据目录也指到临时目录，备份写在那里）
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.AGENT_PANEL_DATA = mkdtempSync(path.join(tmpdir(), 'agent-panel-table-actions-data-'))
const { Hono } = await import('hono')
const { tablesApi } = await import('./tables/routes.ts')
const { tableActions } = await import('./actions.ts')

const dir = mkdtempSync(path.join(tmpdir(), 'agent-panel-table-actions-'))
mkdirSync(path.join(dir, 'Config'))
const file = path.join(dir, 'Config', 'Item.csv')
writeFileSync(file, 'uint32,string,Quality\nID,Name,Q\n1,木剑,Common\n2,铁剑,Rare\n')
mkdirSync(path.join(dir, '.agentpanel', 'tables'), { recursive: true })
writeFileSync(
  path.join(dir, '.agentpanel', 'tables', 'enums.json'),
  JSON.stringify({ Quality: { values: [{ name: 'Common' }, { name: 'Rare' }] } }),
)
// 表头按配置：类型、字段名两行
writeFileSync(
  path.join(dir, '.agentpanel', 'tables', 'style.json'),
  JSON.stringify({ header: { start: 0, rows: [{ kind: 'type' }, { kind: 'name' }] } }),
)
const project = { id: 'p1', name: 'g', path: dir, plugins: { tables: { dirs: ['Config'] } } }
const app = new Hono().route(
  '/api/plugins/tables/api/tables',
  tablesApi({ projects: { get: async () => project as never } }),
)
const caller = { taskId: 't', projectId: 'p1', parentTaskId: '' }
/** 和面板动作表一样：进程内调接口，非 2xx 把接口给的原因抛出来；出错收成 { ok: false, error } */
const ctx = {
  caller,
  ui: () => 0,
  api: async (method: string, p: string, body?: unknown) => {
    const res = await app.fetch(
      new Request(`http://x/api${p}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `接口返回 ${res.status}`)
    return data
  },
}
async function runAppAction(name: string, args: unknown, _caller: unknown) {
  const a = tableActions.find((x) => x.name === name)!
  try {
    return { ok: true as const, result: await a.run(a.input.parse(args), ctx) }
  } catch (e) {
    return { ok: false as const, error: (e as Error).message }
  }
}

test('查：按字段名返回行和主键字段', async () => {
  const r = await runAppAction('table.query', { path: 'Config/Item.csv', where: { Q: 'Rare' } }, caller)
  assert.ok(r.ok)
  const v = r.result as { key: string; rows: { row: number; values: Record<string, string> }[] }
  assert.equal(v.key, 'ID')
  assert.deepEqual(v.rows, [{ row: 4, values: { ID: '2', Name: '铁剑', Q: 'Rare' } }])
})

test('改：枚举值不对时不写；对了按主键写进去，文件其它内容不变', async () => {
  const bad = await runAppAction(
    'table.edit',
    { path: 'Config/Item.csv', set: [{ key: '1', values: { Q: 'Epic' } }] },
    caller,
  )
  assert.equal(bad.ok, false)
  assert.match((bad as { error: string }).error, /不符合表格结构[\s\S]*Epic/)
  assert.match(readFileSync(file, 'utf8'), /1,木剑,Common/)
  const ok = await runAppAction(
    'table.edit',
    {
      path: 'Config/Item.csv',
      set: [{ key: '1', values: { Q: 'Rare' } }],
      add: [{ ID: '3', Name: '木盾', Q: 'Common' }],
    },
    caller,
  )
  assert.ok(ok.ok, JSON.stringify(ok))
  assert.equal(
    readFileSync(file, 'utf8'),
    'uint32,string,Quality\nID,Name,Q\n1,木剑,Rare\n2,铁剑,Rare\n3,木盾,Common\n',
  )
})

test('提议：不写文件，存成表格页能取的提议；结构不对同样拦下', async () => {
  const before = readFileSync(file, 'utf8')
  const bad = await runAppAction('table.propose', { path: 'Config/Item.csv', add: [{ ID: '9', Q: 'Epic' }] }, caller)
  assert.equal(bad.ok, false)
  const ok = await runAppAction(
    'table.propose',
    { path: 'Config/Item.csv', add: [{ ID: '9', Name: '铜剑', Q: 'Common' }], note: '加一把铜剑' },
    caller,
  )
  assert.ok(ok.ok, JSON.stringify(ok))
  assert.equal(readFileSync(file, 'utf8'), before)
  const got = (await (
    await app.fetch(new Request('http://x/api/plugins/tables/api/tables/p1/proposal?path=Config/Item.csv'))
  ).json()) as {
    proposal: { note: string; added: number; edit: { rows: unknown[]; cells: unknown[] } }
  }
  assert.equal(got.proposal.note, '加一把铜剑')
  assert.equal(got.proposal.added, 1)
  assert.equal(got.proposal.edit.rows.length, 1)
  await app.fetch(
    new Request('http://x/api/plugins/tables/api/tables/p1/proposal?path=Config/Item.csv', { method: 'DELETE' }),
  )
  const gone = (await (
    await app.fetch(new Request('http://x/api/plugins/tables/api/tables/p1/proposal?path=Config/Item.csv'))
  ).json()) as {
    proposal: unknown
  }
  assert.equal(gone.proposal, null)
})

test('列出表格：name 按表名找，只看路径不读内容；找不到时说明', async () => {
  const all = await runAppAction('table.list', {}, caller)
  assert.ok(all.ok, JSON.stringify(all))
  assert.ok((all.result as { files: string[] }).files.includes('Config/Item.csv'))
  const hit = await runAppAction('table.list', { name: 'config ITEM' }, caller)
  assert.deepEqual((hit.result as { files: string[] }).files, ['Config/Item.csv'])
  const miss = await runAppAction('table.list', { name: 'Rare' }, caller)
  const v = miss.result as { files: string[]; note?: string }
  assert.deepEqual(v.files, [])
  assert.match(v.note ?? '', /Rare/)
  // 按内容跨表找的动作已经去掉：表格不做预处理，读全部内容太慢
  assert.equal(
    tableActions.some((x) => x.name === 'table.search'),
    false,
  )
})

test('列结构：类型、枚举能填的值、表头几行、数据从第几行开始', async () => {
  const r = await runAppAction('table.schema', { path: 'Config/Item.csv' }, caller)
  assert.ok(r.ok, JSON.stringify(r))
  const v = r.result as {
    key: string
    dataFrom: number
    header: { row: number; role: string }[]
    columns: { col: string; field: string; type: string; kind: string; enum?: { name: string; values: string[] } }[]
  }
  assert.equal(v.key, 'ID')
  assert.equal(v.dataFrom, 3)
  assert.deepEqual(
    v.header.map((h) => h.role),
    ['type', 'name'],
  )
  const q = v.columns.find((c) => c.field === 'Q')!
  assert.equal(q.kind, 'enum')
  assert.deepEqual(q.enum?.values.slice(0, 2), ['Common', 'Rare'])
  assert.equal(v.columns.find((c) => c.field === 'ID')?.kind, 'uint')
})
