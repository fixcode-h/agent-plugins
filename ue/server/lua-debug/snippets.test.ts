// Lua 片段：存放位置跟资源收藏的设置走、按动作改、批准只认代码哈希（代码或 self 改了自动失效）。
// 用法：node --test ue/server/lua-debug/snippets.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import type { UeProject } from '../types.ts'
import { setCtx } from '../util.ts'
import { editSnippets, listSnippets, snippetFile } from './snippets.ts'

let base = ''
const proj = (id: string, favStore: UeProject['favStore'] = 'docs') =>
  ({ id, root: path.join(base, id, 'Game'), favStore }) as UeProject

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'ue-snippets-'))
  setCtx({
    dataDir: path.join(base, 'data'),
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
})

test('存放位置跟资源收藏的设置走：docs/AgentPanel/UE 或 .agent-panel/ue', () => {
  const p = proj('a')
  assert.equal(snippetFile(p), path.join(p.root, 'docs', 'AgentPanel', 'UE', 'lua-snippets.json'))
  assert.equal(snippetFile(proj('a', 'project')), path.join(p.root, '.agent-panel', 'ue', 'lua-snippets.json'))
})

test('保存、批准、改名带着批准、删除', async () => {
  const p = proj('b')
  await editSnippets(p, { action: 'save', name: '刷新背包', code: 'BagPanel:Refresh()', approve: true })
  let r = await listSnippets(p)
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].approved, true)
  await editSnippets(p, { action: 'save', oldName: '刷新背包', name: '刷新背包界面', code: 'BagPanel:Refresh()' })
  r = await listSnippets(p)
  assert.deepEqual(
    r.items.map((s) => [s.name, s.approved]),
    [['刷新背包界面', true]],
  )
  await editSnippets(p, { action: 'approve', name: '刷新背包界面', on: false })
  assert.equal((await listSnippets(p)).items[0].approved, false)
  await editSnippets(p, { action: 'remove', name: '刷新背包界面' })
  assert.equal((await listSnippets(p)).items.length, 0)
})

test('仓库里的片段被改过（代码或 self）批准自动失效：批准只在本机、认的是哈希', async () => {
  const p = proj('c')
  await editSnippets(p, { action: 'save', name: 'GM', code: 'GM.AddItem(1, 1)', approve: true })
  const file = snippetFile(p)
  const data = JSON.parse(await readFile(file, 'utf8')) as { snippets: { code: string; self?: string }[] }
  data.snippets[0].code = 'os.exit()'
  await writeFile(file, JSON.stringify(data))
  assert.equal((await listSnippets(p)).items[0].approved, false)
  data.snippets[0].code = 'GM.AddItem(1, 1)'
  data.snippets[0].self = '/Game/Maps/Test.Test:PersistentLevel.Hero'
  await writeFile(file, JSON.stringify(data))
  assert.equal((await listSnippets(p)).items[0].approved, false)
})

test('名字不能空、不能重名、不能换行', async () => {
  const p = proj('d')
  await assert.rejects(editSnippets(p, { action: 'save', name: ' ', code: 'x' }))
  await assert.rejects(editSnippets(p, { action: 'save', name: 'a\nb', code: 'x' }))
  await editSnippets(p, { action: 'save', name: 'a', code: 'x' })
  await editSnippets(p, { action: 'save', name: 'b', code: 'y' })
  await assert.rejects(editSnippets(p, { action: 'save', oldName: 'b', name: 'a', code: 'y' }))
})
