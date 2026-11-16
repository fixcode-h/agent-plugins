// 冒烟测试：用假的面板上下文激活构建好的包（dist/ue），连一个假的桥接（scripts/fake-bridge.mjs），不需要装 UE。
// 检查：哪些对话挂工具；21 个工具都在；保存和编译工具的作用声明（改了哪些文件、编译通过没有）；状态、找 Actor、改属性进操作记录并能撤回；危险命令要确认、拒绝就不执行；
// 运行时只读权限挡住写操作；日志增量取和清空；UE 没在运行时按关键字搜日志文件；
// UnLua：按模块找对象、读实例表和全局表、改 Lua 字段并撤回、执行 Lua 每次都要确认（权限设成可写也一样）。
// 性能和内存：CSV 抓取（开始、书签、停止、找到新文件）、摘要和卡顿查询、两份 memreport 对比、询问权限下要确认、只读权限拒绝、删除要确认。
// 资源和蓝图：大纲、图表伪代码、搜节点；操作列表演练不留改动、正式修改能撤回、失败整批取消；另一个对话改同一个没保存的包会被拒绝；
// 结构性操作按权限确认，删除每次确认；Python 默认关。（图表和编译本身只有引擎里有，这里只查参数、权限和确认流程）
// 评审转 .uasset（textify）：临时文件位置、包名、同内容走缓存、没接入的项目报错（真正的加载导出只有引擎里有）。
// 用法：npm run build -- ue && node ue/scripts/smoke.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

/** 目录里还剩下的东西 */
const hasEntries = (d) => readdirSync(d).length > 0
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fakeLuaError } from './fake-lua-dev.mjs'
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
// 级别筛选：一条带续行的警告（UE 多行消息只有第一行带前缀），网页选「警告」时不能混进上面的错误
big.push(
  '[2026.11.10-15.00.01:000][  0]LogScript: Warning: Script Msg: careful',
  'Script call stack:',
  '    /Game/Foo.Foo:Bar',
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
  // 项目能力（插件接口 9）：记下插件替哪些项目打开了自己
  projects: {
    enabled: async (id) => enabledFor.has(id),
    enable: async (id, on = true) => void (on ? enabledFor.add(id) : enabledFor.delete(id)),
  },
}
const enabledFor = new Set()
const bridge = await startFakeBridge(proj)
// 面板开放给插件的模块（server/download）：冒烟测试不连外网，给一份用 fetch 写文件的替身
globalThis.__agentPanelServer = {
  modules: {
    'server/download': {
      downloadFile: async (url, to) => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        mkdirSync(path.dirname(to), { recursive: true })
        writeFileSync(to, Buffer.from(await res.arrayBuffer()))
      },
    },
  },
}
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
  // 在 UE 页接入就顺手在项目「能力」里打开；按目录推荐、还缺什么（插件接口 9）
  assert.deepEqual([...enabledFor].sort(), ['p1', 'p2'])
  assert.match((await plugin.detect({ path: proj })) ?? '', /Fake\.uproject/)
  assert.equal(await plugin.detect({ path: data }), undefined)
  assert.match((await plugin.ready({ id: 'nope', path: tmp })) ?? '', /接入/)
  assert.match((await plugin.ready({ id: 'p1', path: proj })) ?? '', /UELink/)

  // 挂工具：没接入的项目、聊天对话不挂，并说明原因（插件接口 8 的 skip，设置 →「MCP」的自检照原文显示）
  assert.deepEqual(
    await plugin.tools({ taskId: 'a', agentName: 'x', skills: [], resume: false, projectId: 'nope', mode: 'agent' }),
    { skip: '这个项目还没在 UE 页接入' },
  )
  assert.match(
    (await plugin.tools({ taskId: 'a', agentName: 'x', skills: [], resume: false, projectId: 'p1', mode: 'chat' }))
      .skip,
    /Chat 页/,
  )
  // 能力目录：不开对话也能列出工具，每个都写了作用和什么时候用
  const cat = await plugin.catalog()
  assert.deepEqual(
    cat.servers.map((s) => s.name),
    ['ue'],
  )
  const catTools = await cat.servers[0].tools()
  assert.equal(catTools.length, 21)
  assert.deepEqual(
    catTools.filter((x) => !x.guide?.useWhen).map((x) => x.name),
    [],
  )
  assert.ok(catTools.every((x) => !('call' in x)))
  // 面板 ADR 0067：一个工具的定义（说明 + 参数 schema）不超过 3000 字
  for (const x of catTools) {
    const len = String(x.description ?? '').length + JSON.stringify(x.inputSchema ?? x.parameters ?? {}).length
    assert.ok(len <= 3000, `${x.name} 的定义 ${len} 字，超过 3000`)
  }
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
  assert.ok(runTools.servers[0].summary)
  const tools = Object.fromEntries((await runTools.servers[0].tools()).map((x) => [x.name, x]))
  assert.equal(Object.keys(tools).length, 19)
  const call = (name, args, extra = {}) => tools[name].call(args, { taskId: 't1', callId: '1', ...extra })
  // 面板 ADR 0067：一个工具的定义（说明 + 参数）不超过 3000 字
  for (const x of Object.values(tools)) {
    const size = (x.description ?? '').length + JSON.stringify(x.inputSchema ?? x.parameters ?? {}).length
    assert.ok(size <= 3000, `${x.name} 的定义 ${size} 字，超过 3000`)
  }

  const st = await call('ue_status', {})
  assert.match(text(st), /"online": true/)
  const st2 = await api('GET', '/p/p1/state')
  assert.equal(st2.instances[0].worlds.length, 2)

  const found = await call('ue_find', { kind: 'actor', prefix: 'bp_he' })
  assert.match(text(found), /BP_Hero_C_1/)

  // Object 页：类下拉搜类，再在选的类里按名字前缀找（Actor 也按显示名找）；资源页的类型从 UE 里取
  const classes = await api('POST', '/p/p1/op', { op: 'classes', args: { q: 'char' } })
  assert.equal(classes.items[0].path, '/Script/Engine.Character', JSON.stringify(classes))
  const inClass = await api('POST', '/p/p1/op', {
    op: 'objects',
    args: { class: '/Script/Engine.Character', prefix: 'bp_hero' },
  })
  assert.equal(inClass.items[0].label, 'BP_Hero', JSON.stringify(inClass))
  const assetTypes = await api('POST', '/p/p1/op', { op: 'asset.classes', args: { q: 'input' } })
  assert.equal(assetTypes.items[0].name, 'InputAction', JSON.stringify(assetTypes))

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

  // 一次读几个变量；整个对象导出成文件（Actor 带组件，读不了的组件留下原因），回复里只有路径和条数
  const many = JSON.parse(text(await call('ue_get', { path: bridge.hero, props: ['Health', 'MaxHealth', 'NoSuch'] })))
  assert.deepEqual(
    many.items.slice(0, 2).map((i) => i.value),
    [80, 120],
    JSON.stringify(many),
  )
  assert.ok(many.items[2].error, JSON.stringify(many))
  const dump = JSON.parse(text(await call('ue_get', { path: bridge.hero, file: true })))
  assert.ok(dump.file.startsWith(path.join(proj, 'Saved', 'AgentPanel', 'dump')), JSON.stringify(dump))
  const dumped = JSON.parse(readFileSync(dump.file, 'utf8'))
  assert.equal(dumped.props.length, dump.props)
  assert.equal(dumped.components.length, dump.components)
  assert.ok(dumped.components.some((c) => c.props?.length) && dumped.components.some((c) => c.error), dump.file)
  const one = JSON.parse(text(await call('ue_get', { path: bridge.hero, prop: 'Health', file: true })))
  assert.equal(JSON.parse(readFileSync(one.file, 'utf8')).value, 80)

  // 桥接比插件带的旧、又没有这个操作：统一提示更新桥接（插件框架改进 C1），不是只说「不支持」
  const old = await api('POST', '/p/p1/op', { op: 'stat.nosuch', args: {} })
  assert.match(JSON.stringify(old), /UELink（桥接）是 1\.0\.0.*UE 插件/, JSON.stringify(old))

  // 函数执行：网页列出非蓝图函数，网页（你自己点）能执行；Agent 带 any 也调不了
  const fnAll = await api('POST', '/p/p1/op', { op: 'functions', args: { path: bridge.hero, all: true } })
  assert.ok(
    fnAll.items.some((f) => f.access === 'private' && f.blueprint === false),
    JSON.stringify(fnAll),
  )
  const webCall = await api('POST', '/p/p1/op', {
    op: 'call',
    args: { path: bridge.hero, function: 'ResetCache', any: true },
  })
  assert.equal(webCall.ret, true, JSON.stringify(webCall))
  const agentCall = await call('ue_call', { path: bridge.hero, function: 'ResetCache', any: true })
  assert.ok(agentCall.isError, text(agentCall))
  const refs = await api('POST', '/p/p1/op', {
    op: 'object.refs',
    args: { path: bridge.hero, class: '/Script/Engine.MaterialInterface' },
  })
  assert.equal(refs.items[0].via, 'Mesh.OverrideMaterials[0]', JSON.stringify(refs))

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

  // 编辑器小工具（UELink 2.4）：配置分层 + 进程里的最终值、Tag（进程 + ini 注释）、放删 Actor 按结构性操作确认并能撤回、修复重定向器
  mkdirSync(path.join(proj, 'Config'), { recursive: true })
  writeFileSync(path.join(proj, 'Config', 'DefaultEngine.ini'), '[/Script/Engine.RendererSettings]\nr.Shadow=0\n')
  writeFileSync(
    path.join(proj, 'Config', 'DefaultGameplayTags.ini'),
    '[/Script/GameplayTags.GameplayTagsSettings]\n+GameplayTagList=(Tag="Ability.Fire",DevComment="开火")\n',
  )
  const cfgKeys = await api('POST', '/p/p1/tools/config', {
    file: 'Engine',
    section: '/Script/Engine.RendererSettings',
  })
  const shadow = cfgKeys.keys.find((k) => k.key === 'r.Shadow')
  assert.deepEqual([shadow.values, shadow.live, shadow.differs], [['0'], ['3'], true], JSON.stringify(cfgKeys))
  assert.ok(cfgKeys.keys.some((k) => k.key === 'r.FromPlugin' && !k.layers.length))
  const cfgSecs = await api('POST', '/p/p1/tools/config', { file: 'Engine' })
  assert.ok(
    cfgSecs.sections.some((x) => x.name === 'Plugin.OnlyLive' && x.liveOnly),
    JSON.stringify(cfgSecs),
  )
  assert.match(text(await call('ue_console', { action: 'config', query: 'r.shadow' })), /DefaultEngine/)
  const tagRes = await api('POST', '/p/p1/tools/tags', {})
  assert.equal(tagRes.items.find((x) => x.tag === 'Ability.Fire').comment, '开火')
  assert.match(text(await call('ue_console', { action: 'tags', tag: 'Ability.Fire' })), /BP_Hero/)
  assert.ok((await call('ue_editor', { action: 'spawn', class: 'PointLight' })).isError, '结构性操作默认要确认')
  assert.ok(!(await call('ue_editor', { action: 'spawn', class: 'PointLight', location: [0, 0, 100] }, yes)).isError)
  assert.equal(bridge.state.tools.spawned.length, 1)
  const spawnHist = (await api('GET', '/p/p1/history')).items.find((i) => i.op === 'editor.spawn')
  assert.ok(spawnHist?.undo, JSON.stringify(spawnHist))
  assert.ok(!(await call('ue_undo', { id: spawnHist.id })).isError)
  assert.equal(bridge.state.tools.spawned.length, 0)
  const redir = await api('POST', '/p/p1/tools/redirectors', { path: '/Game/Old' })
  assert.equal(redir.items.length, 1)
  const fixed = await api('POST', '/p/p1/tools/redirectors/fix', { path: '/Game/Old' })
  assert.equal(fixed.fixed.length, 1, JSON.stringify(fixed))
  const diag = await api('GET', '/p/p1/tools/diagnose')
  assert.ok(
    diag.items.some((i) => i.id === 'installed' && i.state === 'fail'),
    JSON.stringify(diag),
  )
  assert.ok(
    diag.items.some((i) => i.id.startsWith('port-') && i.state === 'ok'),
    JSON.stringify(diag),
  )

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

  // Lua GM（GM 页 Lua 来源）：扫描脚本列出 GM；Agent 执行按「运行时」权限走，不像 ue_lua 每次确认
  mkdirSync(path.join(proj, 'Content', 'Script', 'GM'), { recursive: true })
  writeFileSync(
    path.join(proj, 'Content', 'Script', 'GM', 'GMBag.lua'),
    '--- 加道具\n---@param itemId integer Item.Id\nfunction GM.AddItem(itemId, count)\nend\n',
  )
  const noScript = JSON.parse(text(await call('ue_gm', { action: 'list', source: 'lua' })))
  assert.match(noScript.luaNote, /扫描脚本/)
  await api('POST', '/p/p1/lua-gm/config', { files: ['Content/Script/GM/**/*.lua'] })
  const store = path.join(proj, 'docs', 'AgentPanel', 'UE')
  mkdirSync(store, { recursive: true })
  writeFileSync(
    path.join(store, 'lua-gm-scan.mjs'),
    `export default (files) => files.flatMap((f) => [...f.text.matchAll(/^function GM\\.(\\w+)\\(([^)]*)\\)/gm)].map((m) => ({
      name: m[1], file: f.path, line: f.text.slice(0, m.index).split('\\n').length, call: 'GM.' + m[1] + '({args})',
      params: m[2].split(',').map((x) => x.trim()).filter(Boolean).map((n) => ({ name: n, type: 'integer', table: n === 'itemId' ? 'Item.Id' : undefined })),
    })))`,
  )
  const luaList = JSON.parse(text(await call('ue_gm', { action: 'list', source: 'lua' })))
  assert.deepEqual(
    luaList.lua.map((x) => [x.name, x.at]),
    [['AddItem', 'Content/Script/GM/GMBag.lua:3']],
  )
  assert.equal(luaList.lua[0].params[0].table, 'Item.Id')
  const gmRun = await call('ue_gm', { action: 'run', source: 'lua', name: 'AddItem', args: [1001, 5] })
  assert.ok(!gmRun.isError, text(gmRun))
  assert.equal(bridge.state.lua.exec.at(-1), 'GM.AddItem(1001, 5)')
  assert.ok(
    (await call('ue_gm', { action: 'run', source: 'lua', name: 'AddItem', args: ['abc'] })).isError,
    '数字参数填了字母',
  )
  const webGm = await api('POST', '/p/p1/lua-gm/run', { name: 'AddItem', args: ['7'] })
  assert.equal(webGm.code, 'GM.AddItem(7)')
  // UELink 2.4：Lua 改完能验（check → reload → errors）、调 Lua 函数、函数签名，ue_status 带编辑器选中
  const chk = await call('ue_lua', { action: 'check', files: ['Content/Script/UI/BadPanel.lua'] })
  assert.match(text(chk), /'end' expected/)
  const mods = await call('ue_lua', { action: 'modules' })
  assert.match(text(mods), /UI\.BagPanel/)
  assert.doesNotMatch(text(mods), /GameInstance/, '默认只列改过还没重载的')
  const rl = await call('ue_lua', { action: 'reload', changed: true })
  assert.ok(!rl.isError, text(rl))
  assert.equal(bridge.state.lua.modules[1].stale, false)
  fakeLuaError(bridge.state, 'UI/BagPanel.lua:42: attempt to index a nil value', 'UI/BagPanel.lua:42')
  fakeLuaError(bridge.state, 'UI/BagPanel.lua:42: attempt to index a nil value', 'UI/BagPanel.lua:42')
  const errs = JSON.parse(text(await call('ue_lua', { action: 'errors' })))
  assert.equal(errs.items[0].count, 2)
  const gold = bridge.state.lua.inst.Gold
  const called = await call('ue_lua', { action: 'call', path: bridge.gi, lua: 'AddGold', self: true, args: [5] })
  assert.ok(!called.isError, text(called))
  assert.equal(bridge.state.lua.inst.Gold, gold + 5)
  assert.match(text(called), /"after": 105/)
  const sig = await call('ue_get', { path: bridge.gi, lua: '', functions: true })
  assert.match(text(sig), /MAX_GOLD/)
  const callHist = JSON.parse(text(await call('ue_undo', {}))).find((i) => i.op === 'lua.call')
  assert.ok(callHist && !callHist.undo, JSON.stringify(callHist))
  const stSel = JSON.parse(text(await call('ue_status', {})))
  assert.match(JSON.stringify(stSel.selection), /Hero/)
  assert.match(JSON.stringify(stSel.selection), /Event BeginPlay/)
  bridge.state.lua.inst.Gold = gold

  // Lua 片段：没批准的 Agent 按名字执行被拒；批准后不弹确认；代码改了批准失效
  await api('POST', '/p/p1/lua/snippets', { action: 'save', name: '刷新', code: 'return 7' })
  const unapproved = await call('ue_lua', { action: 'exec', snippet: '刷新' })
  assert.ok(unapproved.isError && /批准/.test(text(unapproved)), text(unapproved))
  await api('POST', '/p/p1/lua/snippets', { action: 'approve', name: '刷新' })
  let snipAsked = false
  const snipRan = await call(
    'ue_lua',
    { action: 'exec', snippet: '刷新' },
    { confirm: async () => ((snipAsked = true), { allow: true, message: '' }) },
  )
  assert.ok(!snipRan.isError && !snipAsked, `${text(snipRan)} 批准过的片段不再确认`)
  assert.equal(bridge.state.lua.exec.at(-1), 'return 7')
  await api('POST', '/p/p1/lua/snippets', { action: 'save', name: '刷新', code: 'return 8' })
  assert.ok((await call('ue_lua', { action: 'exec', snippet: '刷新' })).isError, '代码改了批准失效')
  const missing = await call('ue_lua', { action: 'exec', snippet: '没有' })
  assert.match(text(missing), /刷新/, '名字不对时列出现有片段')

  // Lua 深度调试：快照点、采样、持有的已销毁对象（UELink 2.4）
  const snap = await call('ue_lua', { action: 'snap', file: 'UI/BagPanel.lua', line: 152, hits: 3 })
  assert.ok(!snap.isError, text(snap))
  const snapId = JSON.parse(text(snap)).snap.id
  assert.match(text(await call('ue_lua', { action: 'snap', id: snapId })), /slotIndex/)
  assert.ok(!(await call('ue_lua', { action: 'snap', remove: true })).isError)
  const prof = await call('ue_lua', { action: 'profile', seconds: 1 })
  assert.match(text(prof), /BagPanel/, text(prof))
  assert.match(text(await call('ue_lua', { action: 'leaks' })), /OpenedPanels/)

  // 日志：增量取、清空
  const tail = await call('ue_log', { action: 'tail' })
  assert.match(text(tail), /connection timeout/)
  const cursor = Number(/cursor=(\d+)/.exec(text(tail))[1])
  await call('ue_console', { command: 'stat unit' })
  const more = await call('ue_log', { action: 'tail', since: cursor })
  assert.doesNotMatch(text(more), /connection timeout/)
  assert.match(text(more), /ran stat unit/)
  // 在跑时桥接按最低级别给，面板再筛：选警告时只剩警告
  const liveWarn = await api('POST', '/p/p1/logs', { verbosity: 'Warning', exact: true })
  assert.ok(liveWarn.live && liveWarn.lines.length > 0)
  assert.ok(
    liveWarn.lines.every((l) => l.verbosity === 'Warning'),
    JSON.stringify(liveWarn.lines),
  )
  const cleared = await call('ue_log', { action: 'clear' })
  assert.ok(!cleared.isError, text(cleared))

  // UE 没在运行：按关键字流式搜日志文件
  const off = await api('POST', '/p/p2/logs', { contains: 'needle' })
  assert.equal(off.live, false)
  assert.equal(off.lines.length, 1)
  assert.equal(off.lines[0].verbosity, 'Error')
  // 网页的级别分段只看这一级：警告不混错误、错误不混警告；续行跟着上一条的级别；计数不随筛选变
  const offWarn = await api('POST', '/p/p2/logs', { verbosity: 'Warning', exact: true })
  assert.deepEqual(
    offWarn.lines.map((l) => [l.verbosity, l.category]),
    Array(3).fill(['Warning', 'LogScript']),
  )
  assert.deepEqual([offWarn.errors, offWarn.warnings], [1, 1])
  const offErr = await api('POST', '/p/p2/logs', { verbosity: 'Error', exact: true })
  assert.deepEqual(
    offErr.lines.map((l) => l.text),
    ['needle found'],
  )
  assert.deepEqual([offErr.errors, offErr.warnings], [1, 1])
  // Agent 的 ue_log 仍按最低级别：Warning 连错误也给
  const offMin = await api('POST', '/p/p2/logs', { verbosity: 'Warning' })
  assert.equal(offMin.lines.length, 4)
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
  const hitches = JSON.parse(
    text(await call('ue_capture', { action: 'query', id: stopped.capture.id, what: 'hitches' })),
  )
  assert.ok(
    hitches.worst[0].spikes.some((s) => s.column === 'Slate/Tick'),
    JSON.stringify(hitches.worst[0]),
  )
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
  const noDel = await call(
    'ue_capture',
    { action: 'delete', id: m1.capture.id },
    { confirm: async () => ({ allow: false, message: 'no' }) },
  )
  assert.ok(noDel.isError, text(noDel))
  assert.ok(existsSync(m1.capture.file))
  const del = await call('ue_capture', { action: 'delete', id: m1.capture.id }, yes)
  assert.ok(!del.isError && !existsSync(m1.capture.file), text(del))
  assert.match(text(await call('ue_capture', { action: 'help' })), /hitches/)
  await api('POST', '/p/p1/settings', { perms: permsBefore })

  // 保存和编译拆成单独的工具，带面板接口 3 的作用声明：编译报验证结论，保存报写回了哪些文件
  assert.equal(tools.ue_save.effect, 'edit')
  assert.equal(tools.ue_compile.effect, 'verify')
  assert.equal(tools.ue_asset.effect, undefined)
  const bpFile =
    path.join(
      proj,
      'Content',
      ...bridge.bp
        .split('.')[0]
        .replace(/^\/Game\//, '')
        .split('/'),
    ) + '.uasset'
  assert.deepEqual(tools.ue_save.targets({ packages: [bridge.bp.split('.')[0]] }), [bpFile])
  const compiled = await call('ue_compile', { path: bridge.bp })
  assert.ok(!compiled.isError, text(compiled))
  assert.deepEqual(compiled.verified, { passed: true, name: '蓝图编译', files: [bpFile] })
  assert.ok((await call('ue_blueprint', { action: 'compile', path: bridge.bp })).isError)
  assert.ok((await call('ue_asset', { action: 'save' })).isError)
  const savedRes = await call('ue_save', { packages: [bridge.bp.split('.')[0]] }, yes)
  assert.ok(!savedRes.isError, text(savedRes))
  assert.deepEqual(savedRes.changed, [bpFile])

  // 评审转 .uasset：临时文件在项目 Saved 下、用完删掉，包名按 Content 换成 /Game；同一内容不再调桥接
  assert.deepEqual(plugin.textify.exts, ['uasset'])
  const tx = (rel, body, side = 'new') => plugin.textify.text({ path: rel, cwd: proj, side, data: Buffer.from(body) })
  const t1 = await tx('Content/Data/BP_Hero.uasset', 'v1')
  assert.equal(t1, '资源 /Game/Data/BP_Hero\nv1')
  assert.equal(await tx('Content/Data/BP_Hero.uasset', 'v1', 'old'), t1)
  assert.equal(bridge.state.textify, 1)
  assert.match(await tx('Content/Data/BP_Hero.uasset', 'v2'), /v2$/)
  assert.ok(
    !existsSync(path.join(proj, 'Saved', 'AgentPanel', 'textify')) ||
      !hasEntries(path.join(proj, 'Saved', 'AgentPanel', 'textify')),
  )
  await assert.rejects(
    () => plugin.textify.text({ path: 'a.uasset', cwd: tmp, side: 'new', data: Buffer.from('x') }),
    /没在 UE 页接入/,
  )

  const hist = await api('GET', '/p/p1/history')
  assert.ok(hist.items.length >= 4)

  // 装 UELink：公共库读不到（更新源指向不存在的目录）时用自带的；清掉合进来的旧插件和 .uproject 里的条目；只升不降
  cfg.uelinkSource = path.join(tmp, 'no-mirror')
  const plugins = path.join(proj, 'Plugins')
  mkdirSync(path.join(plugins, 'AgentPanelBridge', 'Binaries'), { recursive: true })
  writeFileSync(
    path.join(plugins, 'AgentPanelBridge', 'AgentPanelBridge.uplugin'),
    JSON.stringify({ VersionName: '1.9.0' }),
  )
  mkdirSync(path.join(plugins, 'Tools', 'UEToVSLink'), { recursive: true })
  writeFileSync(
    path.join(plugins, 'Tools', 'UEToVSLink', 'UEToVSLink.uplugin'),
    JSON.stringify({ VersionName: '0.2.0' }),
  )
  const uproject = path.join(proj, 'Fake.uproject')
  writeFileSync(
    uproject,
    JSON.stringify({
      EngineAssociation: '5.4',
      Plugins: [
        { Name: 'UEToVSLink', Enabled: true },
        { Name: 'X', Enabled: true },
      ],
    }),
  )
  assert.equal((await api('GET', '/p/p1/state')).bridge, '1.9.0', '旧桥接也认作已安装，好提示升级')
  const ueInst = await api('POST', '/p/p1/install', { mode: 'local' })
  const instJob = await api('GET', `/jobs/${ueInst.job}`)
  assert.equal(instJob.status, 'done', instJob.log.join('\n'))
  assert.ok(
    instJob.log.some((l) => /公共库读不到/.test(l)),
    instJob.log.join('\n'),
  )
  const ueVersion = JSON.parse(readFileSync(path.join(plugins, 'UELink', 'UELink.uplugin'), 'utf8')).VersionName
  assert.match(ueVersion, /^2\./)
  assert.ok(existsSync(path.join(plugins, 'UELink', 'Source', 'UELinkCore', 'UELinkCore.Build.cs')))
  assert.ok(
    !existsSync(path.join(plugins, 'AgentPanelBridge')) && !existsSync(path.join(plugins, 'Tools', 'UEToVSLink')),
  )
  assert.deepEqual(JSON.parse(readFileSync(uproject, 'utf8')).Plugins, [{ Name: 'X', Enabled: true }])
  const record = JSON.parse(readFileSync(path.join(plugins, 'UELink', '.install.json'), 'utf8'))
  assert.equal(record.by, 'agent-panel')
  assert.equal(record.source, 'bundled')
  assert.equal((await api('GET', '/p/p1/state')).bridge, ueVersion)
  // 项目里已经是更新的（UEToVS 装的）：不动
  writeFileSync(path.join(plugins, 'UELink', 'UELink.uplugin'), JSON.stringify({ VersionName: '9.0.0' }))
  const ueAgain = await api('GET', `/jobs/${(await api('POST', '/p/p1/install', { mode: 'local' })).job}`)
  assert.ok(
    ueAgain.log.some((l) => /已经是 UELink 9\.0\.0/.test(l)),
    ueAgain.log.join('\n'),
  )
  assert.equal(JSON.parse(readFileSync(path.join(plugins, 'UELink', 'UELink.uplugin'), 'utf8')).VersionName, '9.0.0')

  console.log(`ue 冒烟测试通过：19 个工具，操作记录 ${hist.items.length} 条`)
} finally {
  await plugin.stop?.()
  await bridge.stop()
  rmSync(tmp, { recursive: true, force: true })
}
