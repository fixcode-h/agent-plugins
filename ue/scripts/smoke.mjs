// 冒烟测试：用假的面板上下文激活构建好的包（dist/ue），连一个假的桥接（scripts/fake-bridge.mjs），不需要装 UE。
// 检查：哪些对话挂工具；12 个工具都在；状态、找 Actor、改属性进操作记录并能撤回；危险命令要确认、拒绝就不执行；
// 运行时只读权限挡住写操作；日志增量取和清空；UE 没在运行时按关键字搜日志文件；
// UnLua：按模块找对象、读实例表和全局表、改 Lua 字段并撤回、执行 Lua 每次都要确认（权限设成可写也一样）。
// 用法：npm run build -- ue && node ue/scripts/smoke.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startFakeBridge } from './fake-bridge.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(here, '..', '..', 'dist', 'ue')
const tmp = mkdtempSync(path.join(tmpdir(), 'ue-smoke-'))
const data = path.join(tmp, 'data')
const proj = path.join(tmp, 'Fake')
const offline = path.join(tmp, 'Offline')
for (const [d, name] of [
  [proj, 'Fake'],
  [offline, 'Offline'],
]) {
  mkdirSync(path.join(d, 'Saved', 'Logs'), { recursive: true })
  writeFileSync(path.join(d, `${name}.uproject`), JSON.stringify({ EngineAssociation: '5.4' }))
}
const big = Array.from(
  { length: 20000 },
  (_, i) => `[2026.11.10-15.00.00:000][  0]LogTemp: ${i === 12345 ? 'Error: needle found' : `line ${i}`}`,
)
writeFileSync(path.join(offline, 'Saved', 'Logs', 'Offline.log'), big.join('\n') + '\n')

const cfg = { attach: 'project', offline: 'off', idleMinutes: 10, dangerous: 'quit, open *', historyDays: 30 }
const ctx = {
  id: 'ue',
  version: 'smoke',
  dir,
  dataDir: data,
  config: () => cfg,
  log: { info: () => {}, warn: (m, d) => console.warn('[warn]', m, d ?? '') },
  t: (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => String(v?.[k] ?? '')),
}
const bridge = await startFakeBridge(proj)
const { default: activate } = await import(pathToFileURL(path.join(dir, 'server', 'index.js')).href)
const plugin = await activate(ctx)
const api = async (method, p, body) => {
  const res = await plugin.fetch(new Request(`http://x${p}`, { method, body: body ? JSON.stringify(body) : undefined }))
  return res.json()
}
const text = (r) => r.content.map((c) => c.text ?? '').join('\n')

try {
  // 接入项目（不装桥接）
  const added = await api('POST', '/projects', { id: 'p1', name: 'Fake', path: proj, mode: 'none' })
  assert.equal(added.project.uname, 'Fake', JSON.stringify(added))
  await api('POST', '/projects', { id: 'p2', name: 'Offline', path: offline, mode: 'none' })

  // 挂工具：没接入的项目、聊天对话不挂
  assert.equal(
    await plugin.tools({ taskId: 'a', agentName: 'x', skills: [], resume: false, projectId: 'nope', mode: 'agent' }),
    undefined,
  )
  assert.equal(
    await plugin.tools({ taskId: 'a', agentName: 'x', skills: [], resume: false, projectId: 'p1', mode: 'chat' }),
    undefined,
  )
  const runTools = await plugin.tools({
    taskId: 't1',
    agentName: 'UE 调试',
    skills: [],
    resume: false,
    projectId: 'p1',
    mode: 'agent',
  })
  assert.deepEqual(
    runTools.servers.map((s) => s.name),
    ['ue'],
  )
  assert.match(runTools.hint, /ue_status/)
  const tools = Object.fromEntries((await runTools.servers[0].tools()).map((x) => [x.name, x]))
  assert.equal(Object.keys(tools).length, 13)
  const call = (name, args, extra = {}) => tools[name].call(args, { taskId: 't1', callId: '1', ...extra })

  const st = await call('ue_status', {})
  assert.match(text(st), /"online": true/)
  const st2 = await api('GET', '/p/p1/state')
  assert.equal(st2.instances[0].worlds.length, 2)

  const found = await call('ue_find', { kind: 'actor', prefix: 'bp_he' })
  assert.match(text(found), /BP_Hero_C_1/)

  // 改属性 → 操作记录 → 撤回
  const set = await call('ue_set', { path: bridge.hero, prop: 'Health', value: 10 })
  assert.ok(!set.isError, text(set))
  assert.equal(bridge.state.hero.Health, 10)
  const mine = JSON.parse(text(await call('ue_undo', {})))
  assert.equal(mine.length, 1)
  assert.equal(mine[0].undo, true)
  const undone = await call('ue_undo', { id: mine[0].id })
  assert.ok(!undone.isError, text(undone))
  assert.equal(bridge.state.hero.Health, 80)

  // 危险命令：没有确认卡片 → 报错；拒绝 → 不执行；允许 → 执行
  assert.ok((await call('ue_console', { command: 'quit' })).isError)
  const denied = await call(
    'ue_console',
    { command: 'quit' },
    { confirm: async () => ({ allow: false, message: 'no' }) },
  )
  assert.ok(denied.isError)
  assert.ok(!bridge.state.calls.includes('quit'))
  await call('ue_console', { command: 'quit' }, { confirm: async () => ({ allow: true, message: '' }) })
  assert.ok(bridge.state.calls.includes('quit'))
  // 网页上：危险命令先回 needConfirm
  assert.equal((await api('POST', '/p/p1/console', { command: 'open Town' })).needConfirm, true)

  // 运行时只读：写操作被挡
  await api('POST', '/p/p1/settings', { perms: { runtime: 'read', asset: 'ask' } })
  const blocked = await call('ue_set', { path: bridge.hero, prop: 'Health', value: 1 })
  assert.ok(blocked.isError && /只读/.test(text(blocked)), text(blocked))
  assert.equal(bridge.state.hero.Health, 80)
  await api('POST', '/p/p1/settings', { perms: { runtime: 'write', asset: 'ask' } })

  // UnLua：找对象、读、改、撤回、执行
  assert.equal(st2.instances[0].lua.available, true)
  const luaFound = await call('ue_find', { kind: 'lua', module: 'gameinstance' })
  assert.match(text(luaFound), /Game\.Core\.GameInstance/)
  const inst = await call('ue_get', { path: bridge.gi, lua: '' })
  assert.match(text(inst), /ReceiveBeginPlay/)
  assert.match(text(inst), /"k": "Gold"/)
  const glob = await call('ue_get', { lua: '_G.GameSystemManager.Players[2]' })
  assert.match(text(glob), /bob/)
  const lset = await call('ue_set', { path: bridge.gi, lua: 'Bag.Size', value: 30 })
  assert.ok(!lset.isError, text(lset))
  assert.equal(bridge.state.lua.inst.Bag.Size, 30)
  assert.ok((await call('ue_set', { path: bridge.gi, lua: 'Bag', value: 1 })).isError)
  const luaHist = JSON.parse(text(await call('ue_undo', {}))).find((i) => i.op === 'lua.set')
  assert.ok(luaHist?.undo, JSON.stringify(luaHist))
  assert.ok(!(await call('ue_undo', { id: luaHist.id })).isError)
  assert.equal(bridge.state.lua.inst.Bag.Size, 20)
  assert.ok((await call('ue_lua', { code: 'return 1' })).isError, '没有确认卡片时不能执行 Lua')
  let asked = ''
  const ran = await call(
    'ue_lua',
    { code: 'print("hello") return 42' },
    {
      confirm: async (req) => {
        asked = req.title
        return { allow: true, message: '' }
      },
    },
  )
  assert.ok(!ran.isError, text(ran))
  assert.match(asked, /Lua/)
  assert.match(text(ran), /hello/)
  const bad = await call('ue_lua', { code: 'error("x")' }, { confirm: async () => ({ allow: true, message: '' }) })
  assert.ok(bad.isError && /boom/.test(text(bad)), text(bad))

  // 日志：增量取、清空
  const tail = await call('ue_log', { action: 'tail' })
  assert.match(text(tail), /connection timeout/)
  const cursor = Number(/cursor=(\d+)/.exec(text(tail))[1])
  await call('ue_console', { command: 'stat unit' })
  const more = await call('ue_log', { action: 'tail', since: cursor })
  assert.doesNotMatch(text(more), /connection timeout/)
  assert.match(text(more), /ran stat unit/)
  const cleared = await call('ue_log', { action: 'clear' })
  assert.ok(!cleared.isError, text(cleared))

  // UE 没在运行：按关键字流式搜日志文件
  const off = await api('POST', '/p/p2/logs', { contains: 'needle' })
  assert.equal(off.live, false)
  assert.equal(off.lines.length, 1)
  assert.equal(off.lines[0].verbosity, 'Error')
  // 运行时操作给出说明，不起后台编辑器（参数里关了）
  const noUe = await plugin.tools({
    taskId: 't2',
    agentName: 'x',
    skills: [],
    resume: false,
    projectId: 'p2',
    mode: 'agent',
  })
  const noUeTools = Object.fromEntries((await noUe.servers[0].tools()).map((x) => [x.name, x]))
  const r = await noUeTools.ue_find.call({ kind: 'actor', prefix: 'BP' }, { taskId: 't2', callId: '1' })
  assert.ok(r.isError && /没在运行/.test(text(r)), text(r))

  const hist = await api('GET', '/p/p1/history')
  assert.ok(hist.items.length >= 4)
  console.log(`ue 冒烟测试通过：13 个工具，操作记录 ${hist.items.length} 条`)
} finally {
  await plugin.stop?.()
  await bridge.stop()
  rmSync(tmp, { recursive: true, force: true })
}
