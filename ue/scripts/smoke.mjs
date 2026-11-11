// 冒烟测试：用假的面板上下文激活构建好的包（dist/ue），连一个假的桥接（scripts/fake-bridge.mjs），不需要装 UE。
// 检查：哪些对话挂工具；17 个工具都在；状态、找 Actor、改属性进操作记录并能撤回；危险命令要确认、拒绝就不执行；
// 运行时只读权限挡住写操作；日志增量取和清空；UE 没在运行时按关键字搜日志文件；
// UnLua：按模块找对象、读实例表和全局表、改 Lua 字段并撤回、执行 Lua 每次都要确认（权限设成可写也一样）。
// 性能和内存：CSV 抓取（开始、书签、停止、找到新文件）、摘要和卡顿查询、两份 memreport 对比、询问权限下要确认、只读权限拒绝、删除要确认。
// 资源和蓝图：大纲、图表伪代码、搜节点；操作列表演练不留改动、正式修改能撤回、失败整批取消；另一个对话改同一个没保存的包会被拒绝；
// 结构性操作按权限确认，删除每次确认；Python 默认关。（图表和编译本身只有引擎里有，这里只查参数、权限和确认流程）
// 评审转 .uasset（textify）：临时文件位置、包名、同内容走缓存、没接入的项目报错（真正的加载导出只有引擎里有）。
// 用法：npm run build -- ue && node ue/scripts/smoke.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'

/** 目录里还剩下的东西 */
const hasEntries = (d) => readdirSync(d).length > 0
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
  assert.equal(Object.keys(tools).length, 17)
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

  // 对话里点 .uasset 的查看窗口：磁盘路径 → 目录 + 名字去找资源（网页再挑名字完全一样的那个）→ 表格
  const byFile = await api('POST', '/p/p1/op', {
    op: 'assets',
    args: { class: '', prefix: path.join(proj, 'Content', 'DT_Items.uasset'), path: '/Game', limit: 50 },
    target: { instance: 'editor' },
  })
  assert.deepEqual(byFile.searched, { path: '/Game', prefix: 'DT_Items' }, JSON.stringify(byFile))
  const dt = byFile.items.find((x) => x.name === 'DT_Items')
  assert.equal(dt?.class, 'DataTable')
  const table = await api('POST', '/p/p1/op', { op: 'datatable', args: { path: dt.path, offset: 0, limit: 50 } })
  assert.equal(table.total, 3, JSON.stringify(table))

  // ----- 资源和蓝图 -----
  const yes = { confirm: async () => ({ allow: true, message: '' }) }
  assert.match(text(await call('ue_blueprint', { action: 'outline', path: bridge.bp })), /"MaxHP"/)
  const pseudo = text(await call('ue_blueprint', { action: 'graph', path: bridge.bp }))
  assert.match(pseudo, /Event ReceiveBeginPlay\(\) {2}#a1b2c3d4\n {2}HP = MaxHP/, pseudo)
  assert.match(text(await call('ue_blueprint', { action: 'node_search', path: bridge.bp, query: 'print' })), /f00dfeed/)
  assert.match(text(await call('ue_find', { kind: 'node', query: 'PrintString' })), /a1b2c3d4/)
  assert.match(text(await call('ue_asset', { action: 'refs', path: bridge.bp })), /Maps\/Town/)
  assert.match(text(await call('ue_asset', { action: 'help', class: 'Blueprint' })), /ue_blueprint edit/)

  // 演练：不留改动、不进操作记录；正式修改：记录里能撤回
  const addVar = [{ op: 'add_variable', name: 'Shield', type: 'float' }]
  const dry = await call('ue_blueprint', { action: 'edit', path: bridge.bp, ops: addVar, dryRun: true })
  assert.ok(!dry.isError && /"dryRun": true/.test(text(dry)), text(dry))
  assert.equal(bridge.state.bp.vars.length, 1)
  const histBefore = (await api('GET', '/p/p1/history')).items.length
  const edited = await call('ue_blueprint', { action: 'edit', path: bridge.bp, ops: addVar })
  assert.ok(!edited.isError, text(edited))
  assert.equal(bridge.state.bp.vars.length, 2)
  assert.equal((await api('GET', '/p/p1/history')).items.length, histBefore + 1)
  // 一步失败整批取消
  const failed = await call('ue_blueprint', {
    action: 'edit',
    path: bridge.bp,
    ops: [{ op: 'add_variable', name: 'X', type: 'int' }, { op: 'explode' }],
  })
  assert.ok(failed.isError && /第 2 个操作/.test(text(failed)), text(failed))
  assert.equal(bridge.state.bp.vars.length, 2)
  // 另一个对话改同一个还没保存的蓝图：拒绝
  const other = await tools.ue_blueprint.call(
    { action: 'edit', path: bridge.bp, ops: addVar },
    { taskId: 'other', callId: '1' },
  )
  assert.ok(other.isError && /另一个对话/.test(text(other)), text(other))
  // 撤回
  const bpUndo = JSON.parse(text(await call('ue_undo', {}))).find((i) => i.op === 'bp.edit' && i.undo)
  assert.ok(bpUndo, '蓝图修改应该能撤回')
  assert.ok(!(await call('ue_undo', { id: bpUndo.id })).isError)
  assert.equal(bridge.state.bp.vars.length, 1)

  // 结构性操作：默认每次问；没有确认卡片 → 报错；演练不用确认
  assert.ok((await call('ue_asset', { action: 'create', path: '/Game/BP_New', parent: 'Actor' })).isError)
  assert.ok(
    !(await call('ue_asset', { action: 'create', path: '/Game/BP_New', parent: 'Actor', dryRun: true })).isError,
  )
  assert.ok(!(await call('ue_asset', { action: 'create', path: '/Game/BP_New', parent: 'Actor' }, yes)).isError)
  assert.deepEqual(bridge.state.bp.created, ['/Game/BP_New'])
  // 删除：权限设成「允许」也照样确认；有引用方时桥接拒绝，原样报出来
  await api('POST', '/p/p1/settings', { perms: { runtime: 'write', asset: 'ask', struct: 'allow', python: false } })
  assert.ok(
    !(await call('ue_asset', { action: 'duplicate', path: bridge.bp, to: '/Game/BP_Copy', dryRun: true })).isError,
  )
  assert.ok((await call('ue_asset', { action: 'delete', path: '/Game/BP_New' })).isError)
  const refBlocked = await call('ue_asset', { action: 'delete', path: bridge.bp }, yes)
  assert.ok(refBlocked.isError && /还被 1 个资源引用/.test(text(refBlocked)), text(refBlocked))
  assert.ok(!(await call('ue_asset', { action: 'delete', path: '/Game/BP_New' }, yes)).isError)
  assert.deepEqual(bridge.state.bp.deleted, ['/Game/BP_New'])
  // Python：默认关；打开后每次确认
  const pyOff = await call('ue_python', { code: 'print(1)' }, yes)
  assert.ok(pyOff.isError && /执行 Python/.test(text(pyOff)), text(pyOff))
  await api('POST', '/p/p1/settings', { perms: { runtime: 'write', asset: 'ask', struct: 'ask', python: true } })
  assert.ok((await call('ue_python', { code: 'print(1)' })).isError)
  const py = await call('ue_python', { code: 'print(1)' }, yes)
  assert.ok(!py.isError && bridge.state.calls.some((c) => /^py ".*run-\d+\.py"$/.test(c)), text(py))

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

  // 编译被 Live Coding 挡住：输出里认出来，作业带上 hint（网页按它给处理方式）
  const lcMsg = 'Unable to build while Live Coding is active. Exit the editor and game, or press Ctrl+Alt+F11'
  await api('POST', '/p/p2/settings', {
    buildCmd: process.platform === 'win32' ? `echo ${lcMsg}& exit /b 6` : `echo '${lcMsg}'; exit 6`,
  })
  const bj = await api('POST', '/p/p2/build', {})
  let job
  for (let i = 0; i < 50; i++) {
    job = await api('GET', `/jobs/${bj.job}`)
    if (job.status !== 'running' && job.hint) break
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.equal(job.status, 'failed', JSON.stringify(job))
  assert.equal(job.hint?.kind, 'live-coding', JSON.stringify(job))


  // ---------- 性能和内存抓取（ue_perf / ue_capture） ----------
  const permsBefore = (await api('GET', '/p/p1/state')).project.perms
  await api('POST', '/p/p1/settings', { perms: { ...permsBefore, runtime: 'read' } })
  const roPerf = await call('ue_perf', { action: 'start', kind: 'csv' })
  assert.ok(roPerf.isError && /只读/.test(text(roPerf)), text(roPerf))
  // 询问权限：按一次抓取确认一遍，卡片上写清种类和时长；之后的书签和停止不再逐条确认
  await api('POST', '/p/p1/settings', { perms: { ...permsBefore, runtime: 'ask' } })
  let perfAsked = 0
  const started = await call(
    'ue_perf',
    { action: 'start', kind: 'csv', seconds: 20, label: '开背包' },
    {
      confirm: async (req) => {
        perfAsked++
        assert.match(req.detail, /最长 20 秒/)
        return { allow: true, message: '' }
      },
    },
  )
  assert.ok(!started.isError, text(started))
  assert.equal(perfAsked, 1)
  assert.ok(bridge.state.calls.includes('CsvProfile Start'))
  const again = await call('ue_perf', { action: 'start', kind: 'csv' }, yes)
  assert.ok(again.isError && /已经有一个抓取在进行/.test(text(again)), text(again))
  assert.match(text(await call('ue_perf', { action: 'status' })), /开背包/)
  const marked = await call('ue_perf', { action: 'mark', name: 'open bag' })
  assert.ok(!marked.isError && bridge.state.calls.includes('CsvEvent open_bag'), text(marked))
  const stopped = JSON.parse(text(await call('ue_perf', { action: 'stop' })))
  assert.equal(stopped.capture.kind, 'csv', JSON.stringify(stopped))
  assert.equal(stopped.marks[0].name, 'open_bag')
  assert.match(text(await call('ue_perf', { action: 'stop' })), /没有正在进行的抓取/)

  // 用起的名字代替 id 查
  const csvSum = JSON.parse(text(await call('ue_capture', { action: 'summary', id: '开背包' })))
  assert.equal(csvSum.capture.id, stopped.capture.id)
  assert.equal(csvSum.summary.frames, 600)
  assert.equal(csvSum.summary.hitches.count, 3)
  const hitches = JSON.parse(text(await call('ue_capture', { action: 'query', id: stopped.capture.id, what: 'hitches' })))
  assert.ok(hitches.worst[0].spikes.some((s) => s.column === 'Slate/Tick'), JSON.stringify(hitches.worst[0]))
  // from 可以写书签名（CSV 里的事件）
  const afterBag = JSON.parse(
    text(await call('ue_capture', { action: 'query', id: stopped.capture.id, what: 'hitches', from: 'close_bag' })),
  )
  assert.equal(afterBag.count, 1)
  const badWhat = await call('ue_capture', { action: 'query', id: stopped.capture.id, what: 'nope' })
  assert.ok(badWhat.isError && /hitches、columns/.test(text(badWhat)), text(badWhat))

  // 两份 memreport 对比：涨得最多的是背包控件
  await api('POST', '/p/p1/settings', { perms: { ...permsBefore, runtime: 'write' } })
  const m1 = JSON.parse(text(await call('ue_perf', { action: 'start', kind: 'memreport', label: '进背包前' })))
  const m2 = JSON.parse(text(await call('ue_perf', { action: 'start', kind: 'memreport', label: '出背包后' })))
  assert.notEqual(m1.capture.id, m2.capture.id)
  const memDiff = JSON.parse(text(await call('ue_capture', { action: 'compare', id: '进背包前', other: '出背包后' })))
  assert.equal(memDiff.diff.byCount[0].class, 'WBP_Bag_C')
  assert.equal(memDiff.diff.byCount[0].countDelta, 40)
  const mixed = await call('ue_capture', { action: 'compare', id: m1.capture.id, other: stopped.capture.id })
  assert.ok(mixed.isError && /同一种/.test(text(mixed)), text(mixed))
  const listed = JSON.parse(text(await call('ue_capture', { action: 'list' })))
  assert.equal(listed.total, 3)

  // 网页接口走同一套；删除在 Agent 这边每次都要确认，拒绝就不删
  const webPerf = await api('GET', '/p/p1/perf')
  assert.equal(webPerf.items.length, 3)
  assert.equal(webPerf.active.length, 0)
  const noDel = await call('ue_capture', { action: 'delete', id: m1.capture.id }, { confirm: async () => ({ allow: false, message: 'no' }) })
  assert.ok(noDel.isError, text(noDel))
  assert.ok(existsSync(m1.capture.file))
  const del = await call('ue_capture', { action: 'delete', id: m1.capture.id }, yes)
  assert.ok(!del.isError && !existsSync(m1.capture.file), text(del))
  assert.match(text(await call('ue_capture', { action: 'help' })), /hitches/)
  await api('POST', '/p/p1/settings', { perms: permsBefore })

  // 评审转 .uasset：临时文件在项目 Saved 下、用完删掉，包名按 Content 换成 /Game；同一内容不再调桥接
  assert.deepEqual(plugin.textify.exts, ['uasset'])
  const tx = (rel, body, side = 'new') => plugin.textify.text({ path: rel, cwd: proj, side, data: Buffer.from(body) })
  const t1 = await tx('Content/Data/BP_Hero.uasset', 'v1')
  assert.equal(t1, '资源 /Game/Data/BP_Hero\nv1')
  assert.equal(await tx('Content/Data/BP_Hero.uasset', 'v1', 'old'), t1)
  assert.equal(bridge.state.textify, 1)
  assert.match(await tx('Content/Data/BP_Hero.uasset', 'v2'), /v2$/)
  assert.ok(!existsSync(path.join(proj, 'Saved', 'AgentPanel', 'textify')) || !hasEntries(path.join(proj, 'Saved', 'AgentPanel', 'textify')))
  await assert.rejects(() => plugin.textify.text({ path: 'a.uasset', cwd: tmp, side: 'new', data: Buffer.from('x') }), /没在 UE 页接入/)

  const hist = await api('GET', '/p/p1/history')
  assert.ok(hist.items.length >= 4)
  console.log(`ue 冒烟测试通过：17 个工具，操作记录 ${hist.items.length} 条`)
} finally {
  await plugin.stop?.()
  await bridge.stop()
  rmSync(tmp, { recursive: true, force: true })
}
