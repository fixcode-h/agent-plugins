// Lua GM：文件模式、脚本输出校验、调用代码、真跑一次扫描脚本（子进程）、设置合并。
// 用法：node --test ue/server/lua-gm/lua-gm.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import type { UeProject } from '../types.ts'
import { setCtx } from '../util.ts'
import { luaCall, luaValue } from './call.ts'
import { matchFiles, patchConfig, readConfig, scriptFile, splitPattern, storeDir } from './config.ts'
import { setDocsRootForTest } from '../doc-root.ts'
import { normalize, scan, stopLuaGmWatch } from './scan.ts'

let base = ''
const proj = (id: string) => ({ id, root: path.join(base, id) }) as UeProject

/** 手写的 GM 文件样例（用户还没给真实的）：GM 挂在 GM 表上，--- 注释写说明，@param 写类型和关联的表 */
const GM_BAG = `local GM = require("GM.Base")

--- @group 背包
--- 给当前角色加道具
---@param itemId integer Item.Id
---@param count integer 数量，不写是 1
function GM.AddItem(itemId, count)
end

--- 清空背包
function GM.ClearBag()
end
`

/** AI 会写出来的那种脚本：逐行认 function GM.xxx，往上收注释 */
const SCRIPT = `export default function scan(files) {
  const out = []
  for (const f of files) {
    const lines = f.text.split('\\n')
    let group = f.path.split('/').pop().replace('.lua', '')
    let doc = []
    lines.forEach((l, i) => {
      const g = l.match(/^---\\s*@group\\s+(.+)/)
      if (g) { group = g[1].trim(); return }
      if (l.startsWith('---')) { doc.push(l.slice(3).trim()); return }
      const m = l.match(/^function GM\\.(\\w+)\\(([^)]*)\\)/)
      if (m) {
        const params = m[2].split(',').map((s) => s.trim()).filter(Boolean).map((n) => {
          const d = doc.find((x) => x.startsWith('@param ' + n + ' '))
          const [, , type, tb] = d ? d.split(/\\s+/) : []
          return { name: n, type: type || 'any', table: /^\\w+\\.\\w+$/.test(tb || '') ? tb : undefined, default: n === 'count' ? '1' : undefined }
        })
        out.push({ name: m[1], group, desc: doc.filter((x) => !x.startsWith('@')).join(' '), file: f.path, line: i + 1, call: 'GM.' + m[1] + '({args})', params })
      }
      doc = []
    })
  }
  return out
}
`

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'ue-luagm-'))
  setCtx({
    dataDir: path.join(base, 'data'),
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
    pages: { push: () => 0 },
  } as unknown as PluginServerContext)
})

test('文件模式：固定开头 + 通配符；** 跨目录，* 不跨', async () => {
  const sp = splitPattern('Content/Script/GM/**/*.lua')
  assert.equal(sp.base, 'Content/Script/GM')
  assert.ok(sp.re!.test('GMBag.lua') && sp.re!.test('sub/GMRole.lua') && !sp.re!.test('GMBag.txt'))
  assert.ok(!splitPattern('GM/*.lua').re!.test('a/b.lua'))
  const root = path.join(base, 'files')
  await mkdir(path.join(root, 'Content/Script/GM/sub'), { recursive: true })
  for (const f of ['GM/A.lua', 'GM/sub/B.lua', 'GM/readme.md', 'Other.lua'])
    await writeFile(path.join(root, 'Content/Script', f), '')
  const m = await matchFiles(root, ['Content/Script/GM/**/*.lua', 'Content/Script/Other.lua', 'Nope/*.lua'])
  assert.deepEqual(m.files, ['Content/Script/GM/A.lua', 'Content/Script/GM/sub/B.lua', 'Content/Script/Other.lua'])
})

test('全局路径：项目外的绝对路径也能扫，结果给绝对路径；设置里能存', async () => {
  assert.equal(splitPattern('/opt/shared/GM/*.lua').base, '/opt/shared/GM')
  assert.equal(splitPattern('G:\\Shared\\GM\\*.lua').base, 'G:/Shared/GM')
  const shared = path.join(base, 'shared-gm')
  await mkdir(path.join(shared, 'sub'), { recursive: true })
  await writeFile(path.join(shared, 'Common.lua'), '')
  await writeFile(path.join(shared, 'sub', 'Deep.lua'), '')
  const root = path.join(base, 'files2')
  await mkdir(root, { recursive: true })
  const slash = (f: string) => f.replaceAll('\\', '/')
  const m = await matchFiles(root, [`${slash(shared)}/**/*.lua`])
  assert.deepEqual(m.files, [`${slash(shared)}/Common.lua`, `${slash(shared)}/sub/Deep.lua`])
  // 项目里的文件写成绝对路径，结果还是相对项目根
  await mkdir(path.join(root, 'GM'), { recursive: true })
  await writeFile(path.join(root, 'GM', 'In.lua'), '')
  assert.deepEqual((await matchFiles(root, [`${slash(root)}/GM/*.lua`])).files, ['GM/In.lua'])
  const p = proj('abs')
  const c = await patchConfig(p, { files: [`${shared}/*.lua`, '../up/*.lua'] })
  assert.deepEqual(c.files, [`${slash(shared)}/*.lua`])
})

test('脚本输出：不是数组直接报错，个别条目不对丢掉并记警告', () => {
  assert.throws(() => normalize('oops', []), /数组/)
  const r = normalize(
    {
      items: [
        { name: 'A', params: ['x', { name: 'y', type: 'integer', default: 2 }] },
        { desc: '没名字' },
        { name: 'A' },
      ],
    },
    ['f.lua'],
  )
  assert.equal(r.items.length, 1)
  assert.deepEqual(r.items[0].params, [
    { name: 'x', type: 'any' },
    { name: 'y', type: 'integer', default: '2' },
  ])
  assert.equal(r.items[0].file, 'f.lua')
  assert.equal(r.warnings.length, 2)
})

test('调用代码：按类型写值，留空用默认值，末尾没默认的空参数去掉', () => {
  const it = {
    name: 'GM.AddItem',
    group: '',
    desc: '',
    file: '',
    line: 1,
    params: [
      { name: 'itemId', type: 'integer' },
      { name: 'count', type: 'integer', default: '1' },
      { name: 'note', type: 'string' },
    ],
  }
  assert.equal(luaCall(it, ['1001', '']), 'GM.AddItem(1001, 1)')
  assert.equal(luaCall(it, ['1001', '5', 'a"b']), 'GM.AddItem(1001, 5, "a\\"b")')
  assert.equal(luaCall({ ...it, call: 'GMMgr:Add({itemId}, {count})' }, ['7']), 'GMMgr:Add(7, 1)')
  assert.throws(() => luaValue({ name: 'n', type: 'integer' }, 'abc'), /要填数字/)
  assert.equal(luaValue({ name: 'b', type: 'boolean' }, 'TRUE'), 'true')
  assert.equal(luaValue({ name: 't', type: 'table' }, '{1,2}'), '{1,2}')
})

test('真跑扫描脚本：读 GM 文件、出错原样带出来', async () => {
  const p = proj('game')
  await mkdir(path.join(p.root, 'Content/Script/GM'), { recursive: true })
  await writeFile(path.join(p.root, 'Content/Script/GM/GMBag.lua'), GM_BAG)
  // 还没设置：不报错，空列表
  let r = await scan(p)
  assert.equal(r.items.length, 0)
  assert.equal(r.hasScript, false)
  await patchConfig(p, { files: ['Content/Script/GM/*.lua'] })
  await mkdir(storeDir(p), { recursive: true })
  await writeFile(path.join(storeDir(p), 'lua-gm-scan.mjs'), SCRIPT)
  r = await scan(p)
  assert.equal(r.error, undefined)
  assert.deepEqual(
    r.items.map((x) => [x.name, x.group, x.line]),
    [
      ['AddItem', '背包', 7],
      ['ClearBag', '背包', 11],
    ],
  )
  assert.equal(r.items[0].params[0].table, 'Item.Id')
  assert.equal(luaCall(r.items[0], ['1001']), 'GM.AddItem(1001, 1)')
  // 脚本抛错：结果为空、错误原样带出，不退回上一次的结果
  await writeFile(path.join(storeDir(p), 'lua-gm-scan.mjs'), 'export default () => { throw new Error("写法变了") }')
  r = await scan(p)
  assert.equal(r.items.length, 0)
  assert.match(r.error ?? '', /写法变了/)
  stopLuaGmWatch()
})

test('参数关联按键合并，null 表示去掉脚本给的关联，undefined 删掉这条改动', async () => {
  const p = proj('cfg')
  await patchConfig(p, {
    binding: { key: 'AddItem.itemId', value: { table: 'Config/Item.xlsx', key: 'Id', label: 'Name' } },
  })
  await patchConfig(p, { binding: { key: 'AddItem.count', value: null } })
  // 页签、辅助描述列原样存（关联弹窗：表格 → 页签 → 主列 → 描述列 → 辅助描述列）
  await patchConfig(p, {
    binding: {
      key: 'SpawnMonster.id',
      value: { table: 'Config/Monster.xlsx', sheet: 'Boss', key: 'Id', extra: ['Level', 'Type', ''] },
    },
  })
  assert.deepEqual((await readConfig(p)).bindings['SpawnMonster.id'], {
    table: 'Config/Monster.xlsx',
    sheet: 'Boss',
    key: 'Id',
    extra: ['Level', 'Type'],
  })
  let c = await readConfig(p)
  assert.deepEqual(c.bindings['AddItem.itemId'], { table: 'Config/Item.xlsx', key: 'Id', label: 'Name' })
  assert.equal(c.bindings['AddItem.count'], null)
  await patchConfig(p, { binding: { key: 'AddItem.count' } })
  c = await readConfig(p)
  assert.ok(!('AddItem.count' in c.bindings))
  // .. 不收；全局路径（项目外的绝对路径）收，见上面「全局路径」那条
  assert.deepEqual((await patchConfig(p, { files: ['../a.lua', 'GM/*.lua'] })).files, ['GM/*.lua'])
})

test('P4 各分支共用文档根：旧规则位置的脚本搬过去，另一个分支直接复用', async () => {
  // 分支 Main 的 UE 项目：升级前脚本和设置按旧规则存在 Main/ProjectDoc/docs 下
  const main = { id: 'main', root: path.join(base, 'p4', 'Main', 'Game') } as UeProject
  const dev = { id: 'dev', root: path.join(base, 'p4', 'Dev', 'Game') } as UeProject
  const shared = path.join(base, 'p4', 'Shared', 'ProjectDoc', 'docs')
  for (const p of [main, dev]) {
    await mkdir(path.join(p.root, 'Content/Script/GM'), { recursive: true })
    await writeFile(path.join(p.root, 'Content/Script/GM/GMBag.lua'), GM_BAG)
  }
  const old = path.join(base, 'p4', 'Main', 'ProjectDoc', 'docs', 'AgentPanel', 'UE')
  await mkdir(old, { recursive: true })
  await writeFile(path.join(old, 'lua-gm-scan.mjs'), SCRIPT)
  await writeFile(path.join(old, 'lua-gm.json'), JSON.stringify({ files: ['Content/Script/GM/*.lua'], bindings: {} }))
  // 面板给的文档根是各分支共用的那份
  setDocsRootForTest('main', shared)
  setDocsRootForTest('dev', shared)
  let r = await scan(main)
  assert.equal(r.error, undefined)
  assert.equal(r.items.length, 2)
  assert.equal(scriptFile(main), path.join(shared, 'AgentPanel', 'UE', 'lua-gm-scan.mjs'))
  // 另一个分支没写过脚本，打开就能用
  r = await scan(dev)
  assert.equal(r.hasScript, true)
  assert.equal(r.items.length, 2)
  setDocsRootForTest('main', undefined)
  setDocsRootForTest('dev', undefined)
  stopLuaGmWatch()
})
