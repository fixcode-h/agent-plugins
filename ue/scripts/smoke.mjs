// 冒烟测试：用假的面板上下文激活构建好的包（dist/ue），连一个假的桥接（scripts/fake-bridge.mjs），不需要装 UE。
// 检查：哪些对话挂工具；24 个工具都在；保存和编译工具的作用声明（改了哪些文件、编译通过没有）；状态、找 Actor、改属性进操作记录并能撤回；危险命令要确认、拒绝就不执行；
// 运行时只读权限挡住写操作；日志增量取和清空；UE 没在运行时按关键字搜日志文件；
// UnLua：按模块找对象、读实例表和全局表、改 Lua 字段并撤回、执行 Lua 每次都要确认（权限设成可写也一样）。
// 性能和内存：CSV 抓取（开始、书签、停止、找到新文件）、摘要和卡顿查询、两份 memreport 对比、询问权限下要确认、只读权限拒绝、删除要确认。
// 资源和蓝图：大纲、图表伪代码、搜节点；操作列表演练不留改动、正式修改能撤回、失败整批取消；另一个对话改同一个没保存的包会被拒绝；
// 结构性操作和删除按权限确认；Python 按三档权限；新项目默认全放开。（图表和编译本身只有引擎里有，这里只查参数、权限和确认流程）
// 评审转 .uasset（textify）：临时文件位置、包名、同内容走缓存、没接入的项目报错（真正的加载导出只有引擎里有）。
// 用法：npm run build -- ue && node ue/scripts/smoke.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
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
// 面板源码（npm run panel 准备，CI 里也有）
const PANEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.panel')
const bridge = await startFakeBridge(proj)
// 面板开放给插件的模块（server/download）：冒烟测试不连外网，给一份用 fetch 写文件的替身
globalThis.__agentPanelServer = {
  modules: {
    // gm.json 的契约（shared/gm/schema.ts）用面板开放的 zod：冒烟测试直接给仓库里装的那份
    zod: await import('zod'),
    // 资源版本差异用的版本记录（面板 server/exec/vcs-history）：冒烟测试不碰版本管理，给个空替身
    'server/exec/vcs-history': {
      fileHistory: async () => ({ vcs: 'none', items: [] }),
      fileAt: async () => {
        throw new Error('冒烟测试里没有版本管理')
      },
      VcsInputError: class extends Error {},
    },
    // 版本管理服务（面板 ADR 0073）：冒烟测试的假项目不在版本管理里
    'server/vcs/detect': { detectVcs: async (d) => ({ vcs: 'none', root: d }) },
    'server/vcs/run': {
      vcsExec: async () => ({
        ok: false,
        code: -1,
        stdout: Buffer.alloc(0),
        stderr: '',
        spawnError: '冒烟测试里没有 p4 / svn',
      }),
      vcsWhy: (cmd) => `冒烟测试里没有 ${cmd}`,
    },
    'server/vcs/p4-plan': {
      p4WritePlan: async () => ({ edit: [], add: [], opened: [], stale: [] }),
      p4Open: async () => undefined,
    },
    'server/p4-split': { p4Runner: () => async () => ({ ok: false, out: '', err: '冒烟测试里没有 p4' }) },
    'server/exec/git': {
      gitRun: async () => ({ code: 1, stdout: '', stderr: '', spawnError: '冒烟测试里没有 git' }),
    },
    // 缓存和文件监听（面板 ADR 0074）：缓存照常算（不过期、不盯文件），监听不开
    'server/memo/index': {
      createMemo: (o) => {
        const m = new Map()
        const keyOf = o.keyOf ?? String
        return {
          get: (k, g) => {
            const key = keyOf(k)
            if (!g?.fresh && m.has(key)) return m.get(key)
            const v = o.load(k)
            m.set(key, v)
            v.catch(() => m.delete(key))
            return v
          },
          peek: (k) => m.get(keyOf(k)),
          invalidate: (k) => (k === undefined ? m.clear() : m.delete(keyOf(k))),
          size: () => m.size,
        }
      },
    },
    'server/watch/dir': { watchDir: () => undefined },
    'server/watch/files': { watchFiles: (files) => ({ close: () => {}, unwatched: files }) },
    'server/watch/tree': { watchTree: () => undefined, TREE_SKIP: new Set() },
    // 后台作业表（面板 ADR 0075）：冒烟测试不看侧栏，给个只记不推的替身
    'server/jobs/registry': {
      startJob: () => ({ id: 'smoke', log: () => {}, progress: () => {}, end: () => {}, canceled: false }),
    },
    // 文档根变化事件：冒烟测试里文档根不会变
    'server/docs/root-cache': { onDocRootChange: () => () => {} },
    // 外部进程入口（面板 ADR 0076）：冒烟测试起的是真进程，只是不登记
    'server/exec/tracked': {
      spawnTracked: (cmd, args, o) => {
        const { source: _s, title: _t, tag: _g, ...opts } = o
        return spawn(cmd, args, { windowsHide: true, ...opts })
      },
      stopTree: async (pid) => {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {}
        return { ok: true }
      },
    },
    // 文件索引帮助函数：冒烟测试没有索引，一律退回自己走目录
    'server/file-index/indexed': {
      readyIndex: async () => undefined,
      indexedTree: async () => undefined,
      indexedDirs: async () => undefined,
      touchIndexed: () => {},
      extsOfGlob: () => undefined,
    },
    // 纯函数的开放模块（文本匹配、镜像注册表）：直接用 .panel 里面板的源码（Node 22 能直接跑 .ts）
    'shared/text-match/index': await import(pathToFileURL(path.join(PANEL, 'shared/text-match/index.ts')).href),
    'shared/mirrors/registry': await import(pathToFileURL(path.join(PANEL, 'shared/mirrors/registry.ts')).href),
    // 出网请求（面板 server/net）：冒烟测试不走代理，直接 fetch
    'server/net': { netFetch: (url, init) => fetch(url, init) },
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
  // 新项目默认全都放开不问；老数据的 python 布尔值读时换算。下面的用例按「要确认」的档位测确认流程
  assert.deepEqual(added.project.perms, { runtime: 'write', asset: 'save', struct: 'allow', python: 'allow' })
  await api('POST', '/p/p1/settings', { perms: { runtime: 'write', asset: 'ask', struct: 'ask', python: true } })
  assert.equal((await api('GET', '/p/p1/state')).project.perms.python, 'ask')
  await api('POST', '/p/p1/settings', { perms: { runtime: 'write', asset: 'ask', struct: 'ask', python: 'read' } })
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
  // Chat 页的对话没有项目：不挂
  assert.match(
    (await plugin.tools({ taskId: 'a', agentName: 'x', skills: [], resume: false, mode: 'chat' })).skip,
    /Chat 页/,
  )
  // 旧面板把项目里的对话、子对话也交成 mode=chat：带着项目的照样挂
  assert.deepEqual(
    (
      await plugin.tools({ taskId: 'a', agentName: 'x', skills: [], resume: false, projectId: 'p1', mode: 'chat' })
    ).servers?.map((s) => s.name),
    ['ue'],
  )
  // 能力目录：不开对话也能列出工具，每个都写了作用和什么时候用
  const cat = await plugin.catalog()
  assert.deepEqual(
    cat.servers.map((s) => s.name),
    ['ue'],
  )
  const catTools = await cat.servers[0].tools()
  assert.equal(catTools.length, 24)
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
  assert.equal(Object.keys(tools).length, 22)
  const call = (name, args, extra = {}) => tools[name].call(args, { taskId: 't1', callId: '1', ...extra })
  // 面板 ADR 0067：一个工具的定义（说明 + 参数）不超过 3000 字
  for (const x of Object.values(tools)) {
    const size = (x.description ?? '').length + JSON.stringify(x.inputSchema ?? x.parameters ?? {}).length
    assert.ok(size <= 3000, `${x.name} 的定义 ${size} 字，超过 3000`)
  }

  const st = await call('ue_status', {})
  assert.match(text(st), /"online":true/)
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
  assert.ok(!dry.isError && /"dryRun":true/.test(text(dry)), text(dry))
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
  // 删除：结构性操作「每次问我」时要确认；有引用方时桥接拒绝，原样报出来
  await api('POST', '/p/p1/settings', { perms: { runtime: 'write', asset: 'ask', struct: 'ask', python: 'read' } })
  assert.ok(
    !(await call('ue_asset', { action: 'duplicate', path: bridge.bp, to: '/Game/BP_Copy', dryRun: true })).isError,
  )
  assert.ok((await call('ue_asset', { action: 'delete', path: '/Game/BP_New' })).isError)
  const refBlocked = await call('ue_asset', { action: 'delete', path: bridge.bp }, yes)
  assert.ok(refBlocked.isError && /还被 1 个资源引用/.test(text(refBlocked)), text(refBlocked))
  assert.ok(!(await call('ue_asset', { action: 'delete', path: '/Game/BP_New' }, yes)).isError)
  assert.deepEqual(bridge.state.bp.deleted, ['/Game/BP_New'])
  // Python：不允许时没有确认卡片就拒绝、有卡片就问这一次放不放行（用户的指令优先，面板 ADR 0070）；
  // 「允许，每次问我」时确认；「允许，不用问我」时直接执行
  const pyOff = await call('ue_python', { code: 'print(1)' })
  assert.ok(pyOff.isError && /执行 Python/.test(text(pyOff)), text(pyOff))
  let pyAsked = ''
  const pyOnce = await call(
    'ue_python',
    { code: 'print(0)' },
    {
      confirm: async (r) => ((pyAsked = r.title), { allow: true, message: '' }),
    },
  )
  assert.ok(!pyOnce.isError && /这次放行吗/.test(pyAsked), text(pyOnce))
  await api('POST', '/p/p1/settings', { perms: { runtime: 'write', asset: 'ask', struct: 'ask', python: 'ask' } })
  assert.ok((await call('ue_python', { code: 'print(1)' })).isError)
  const py = await call('ue_python', { code: 'print(1)' }, yes)
  assert.ok(!py.isError && bridge.state.calls.some((c) => /^py ".*run-\d+\.py"$/.test(c)), text(py))
  await api('POST', '/p/p1/settings', { perms: { runtime: 'write', asset: 'ask', struct: 'allow', python: 'allow' } })
  const pyAllow = await call('ue_python', { code: 'print(2)' })
  assert.ok(!pyAllow.isError, text(pyAllow))
  await api('POST', '/p/p1/settings', { perms: { runtime: 'write', asset: 'ask', struct: 'ask', python: 'ask' } })

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
  // 打开地图（UELink 2.22 editor.map）：PIE 在跑先停；关卡有没保存的改动先报错；discard 请用户确认后丢掉；等打开完才返回
  bridge.state.map.dirty = ['/Game/Maps/Town']
  const dirtyErr = await call('ue_editor', { action: 'open_map', map: 'Maps/Arena' }, yes)
  assert.ok(dirtyErr.isError && /没保存/.test(text(dirtyErr)), text(dirtyErr))
  assert.equal(bridge.state.map.pie, false, '打开地图前先停 PIE')
  let askedDiscard = ''
  const discardYes = {
    confirm: async (r) => {
      if (r.rule === 'map-discard') askedDiscard = r.title
      return { allow: true, message: '' }
    },
  }
  const opened = await call('ue_editor', { action: 'open_map', map: 'Maps/Arena', unsaved: 'discard' }, discardYes)
  assert.ok(!opened.isError, text(opened))
  assert.match(text(opened), /"package":"\/Game\/Maps\/Arena"/, text(opened))
  assert.match(text(opened), /open_map map=\/Game\/Maps\/Town/, '返回里告诉 Agent 怎么换回原图')
  assert.ok(askedDiscard, '丢掉改动要请用户确认')
  assert.equal(bridge.state.map.package, '/Game/Maps/Arena')
  assert.match(text(await call('ue_editor', { action: 'open_map', map: 'Maps/Arena' }, yes)), /"already":true/)
  assert.match(text(await call('ue_editor', { action: 'open_map', map: 'Arena' }, yes)), /有 2 张地图叫 Arena/)
  // pie_start 带 map：只在 PIE 里玩那张图，编辑器的图不动；等 PIE 世界起来才返回
  const pie = await call('ue_editor', { action: 'pie_start', map: '/Game/Maps/Town' }, yes)
  assert.match(text(pie), /"ready":true/, text(pie))
  assert.match(text(pie), /"map":"Town"/, text(pie))
  assert.equal(bridge.state.map.package, '/Game/Maps/Arena')
  assert.ok(!(await call('ue_editor', { action: 'open_map', map: '/Game/Maps/Town' }, yes)).isError)
  assert.ok(!(await call('ue_editor', { action: 'pie_start' }, yes)).isError)
  assert.equal(bridge.state.map.package, '/Game/Maps/Town')
  assert.equal(bridge.state.map.pie, true)
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
  assert.match(text(inst), /"k":"Gold"/)
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
  // 自己跑 GM / GameTest 要过授权卡（self-test-gate.ts）：不在对话里（没有 confirm）直接拒，用户点了允许才跑
  const noCard = await call('ue_gm', { action: 'run', source: 'lua', name: 'AddItem', args: [1001, 5] })
  assert.ok(noCard.isError && /授权卡/.test(text(noCard)), text(noCard))
  const selfTestAsked = []
  const tester = { confirm: async (r) => (selfTestAsked.push(r.rule), { allow: true, message: '' }) }
  const gmRun = await call('ue_gm', { action: 'run', source: 'lua', name: 'AddItem', args: [1001, 5] }, tester)
  assert.deepEqual(selfTestAsked, ['self-test'])
  assert.ok(!gmRun.isError, text(gmRun))
  assert.equal(bridge.state.lua.exec.at(-1), 'GM.AddItem(1001, 5)')
  assert.ok(
    (await call('ue_gm', { action: 'run', source: 'lua', name: 'AddItem', args: ['abc'] }, tester)).isError,
    '数字参数填了字母',
  )
  const webGm = await api('POST', '/p/p1/lua-gm/run', { name: 'AddItem', args: ['7'] })
  assert.equal(webGm.code, 'GM.AddItem(7)')
  // 自定义 GM（规格第 8 节）：save 演练不落盘、存进 gm.json（模块没有就建）、list source=custom 列得出、remove 报出用到它的宏
  const def = {
    name: '买一个',
    module: '商店',
    obj: '商店界面',
    function: 'BuyItem',
    args: { id: 2003 },
    editable: ['id'],
  }
  const objDef = { name: '商店界面', ref: { class: 'WBP_Shop_C' } }
  assert.ok(!(await call('ue_gm', { action: 'save', kind: 'object', def: objDef }, tester)).isError)
  const gmDry = JSON.parse(
    text(
      await call('ue_gm', {
        action: 'save',
        kind: 'gm',
        def: { ...def, objects: { 商店界面: { ref: objDef.ref } } },
        dryRun: true,
      }),
    ),
  )
  assert.ok(gmDry.dryRun && gmDry.newModule, JSON.stringify(gmDry))
  assert.equal(
    JSON.parse(text(await call('ue_gm', { action: 'list', source: 'custom' }))).custom.length,
    0,
    '演练不落盘',
  )
  const gmSaved = await call(
    'ue_gm',
    {
      action: 'save',
      kind: 'gm',
      def: { ...def, objects: { 商店界面: { ref: objDef.ref } } },
    },
    tester,
  )
  assert.ok(!gmSaved.isError, text(gmSaved))
  const customs = JSON.parse(text(await call('ue_gm', { action: 'list', source: 'custom' })))
  assert.ok(
    customs.custom.some((x) => x.name === '买一个' && x.module === '商店'),
    JSON.stringify(customs),
  )
  assert.ok(
    (await call('ue_gm', { action: 'run', source: 'custom', name: '买一个', args: { count: 2 } }, tester)).isError,
    '不可改的参数',
  )
  assert.ok(!(await call('ue_gm', { action: 'remove', kind: 'gm', name: '买一个' })).isError)
  // action=call（2026-11-25）：按对象列表的名字临时调用 / 改值，不在列表里的写清楚怎么办；列表里的对象记进调用记录
  const notIn = await call('ue_gm', { action: 'call', def: { obj: '没有的对象', function: 'Open' } })
  assert.ok(notIn.isError && /对象列表里没有「没有的对象」/.test(text(notIn)), text(notIn))
  // 假桥接没有 GameTest：调用失败也照实记一笔，错误原样给 Agent
  const adhoc = await call('ue_gm', { action: 'call', def: { obj: '商店界面', prop: '@.Gold', value: 9 } })
  assert.ok(adhoc.isError, text(adhoc))
  const rec = JSON.parse(text(await call('ue_gm', { action: 'list', source: 'recent' }))).recent
  assert.ok(
    rec.some((r) => r.key === 'objcall:商店界面' && r.ok === false),
    JSON.stringify(rec),
  )
  // 改变量存成自定义 GM（kind=set）：没写 prop 不存
  const setDef = {
    name: '改金币',
    module: '商店',
    kind: 'set',
    obj: '商店界面',
    objects: { 商店界面: { ref: objDef.ref } },
  }
  assert.ok((await call('ue_gm', { action: 'save', kind: 'gm', def: setDef, dryRun: true })).isError, '没写 prop')
  const setDry = await call('ue_gm', {
    action: 'save',
    kind: 'gm',
    def: { ...setDef, prop: '@.Gold', args: { value: 100 }, editable: ['value'] },
    dryRun: true,
  })
  assert.ok(!setDry.isError, text(setDry))
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
  assert.match(text(called), /"after":105/)
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
  const cursor = Number(JSON.parse(text(tail)).cursor)
  assert.ok(cursor > 0 && tail.structuredContent?.cursor === cursor, '日志结果是结构化的：脚本能直接取 cursor')
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
  // 网页的级别分段只看这一级：警告不混错误、错误不混警告；续行并进上一条成一条多行记录；计数不随筛选变
  const offWarn = await api('POST', '/p/p2/logs', { verbosity: 'Warning', exact: true })
  assert.deepEqual(
    offWarn.lines.map((l) => [l.verbosity, l.category, l.text]),
    [['Warning', 'LogScript', 'Script Msg: careful\nScript call stack:\n    /Game/Foo.Foo:Bar']],
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
  assert.equal(offMin.lines.length, 2)
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

  // trace 带 Lua（Lua 性能分析设计稿 9.3）：和预设叠加、去重；没装 UnLua、UELink 低于 2.9 时只录 UE 部分并说明原因
  {
    const traceStart = async (args) => {
      const r = await call('ue_perf', { action: 'start', kind: 'trace', seconds: 0, ...args })
      assert.ok(!r.isError, text(r))
      const res = JSON.parse(text(r))
      const st = JSON.parse(text(await call('ue_perf', { action: 'status' })))
      // 假桥接不写 .utrace：替它把文件放到期望的位置再停
      const file = st.active[0].file
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, 'utrace')
      const stopped = JSON.parse(text(await call('ue_perf', { action: 'stop' })))
      return {
        res,
        active: st.active[0],
        stopped,
        cmd: bridge.state.calls.filter((x) => x.startsWith('Trace.File')).at(-1),
      }
    }
    // 磁盘上认不出 UnLua：默认不录 Lua；明确要时假桥接报了 Lua 环境（算装了 UnLua），但名片是 1.0.0，照样去掉并说明原因
    let r = await traceStart({ label: 'noLuaDefault' })
    assert.ok(!/\blua\b/.test(r.cmd), r.cmd)
    r = await traceStart({ label: 'noUnLua', lua: true })
    assert.ok(!/\blua\b/.test(r.cmd) && /UnLua|2\.9\.0/.test(r.res.luaNote), JSON.stringify(r.res))
    mkdirSync(path.join(proj, 'Plugins', 'UnLua'), { recursive: true })
    writeFileSync(path.join(proj, 'Plugins', 'UnLua', 'UnLua.uplugin'), '{}')
    // 装了 UnLua 但假桥接的名片是 1.0.0：照常只录 UE 部分，提示升级 UELink
    r = await traceStart({ label: 'oldBridge' })
    assert.ok(!/\blua\b/.test(r.cmd) && /2\.9\.0/.test(r.res.luaNote), JSON.stringify(r.res))
    const cardDir = path.join(proj, 'Saved', 'UELink', 'instances')
    const cardFile = path.join(
      cardDir,
      readdirSync(cardDir).find((f) => f.endsWith('.json')),
    )
    const card = JSON.parse(readFileSync(cardFile, 'utf8'))
    // 2.8.x 已经发过但还没有 Lua 通道，也算旧
    writeFileSync(cardFile, JSON.stringify({ ...card, bridge: '2.8.1' }))
    r = await traceStart({ label: 'bridge281' })
    assert.ok(!/\blua\b/.test(r.cmd) && /2\.9\.0/.test(r.res.luaNote), JSON.stringify(r.res))
    writeFileSync(cardFile, JSON.stringify({ ...card, bridge: '2.9.0' }))
    // 默认（装了 UnLua）：lua,luac 追加在预设后面，和自定义通道去重；没勾 counters 时补上（Lua 计数器要它）；记进抓取登记
    r = await traceStart({ label: 'withLua', preset: 'custom', channels: 'cpu,frame,lua' })
    assert.match(r.cmd, / cpu,frame,lua,luac,counters$/)
    assert.equal(r.active.lua, true)
    assert.equal(r.res.lua, true)
    const luaCap = JSON.parse(text(await call('ue_capture', { action: 'list', kind: 'trace' }))).items.find(
      (x) => x.label === 'withLua',
    )
    assert.equal(luaCap?.lua, true, JSON.stringify(luaCap))
    r = await traceStart({ label: 'noc', lua: 'noc' })
    assert.match(r.cmd, / cpu,gpu,frame,bookmark,counters,log,lua$/)
    // 新预设：和 Lua 叠加；旧键照常可用
    r = await traceStart({ label: 'gpuLua', preset: 'gpu' })
    assert.match(r.cmd, / cpu,gpu,frame,bookmark,counters,log,rhicommands,rendercommands,lua,luac$/)
    r = await traceStart({ label: 'loadOld', preset: 'loading', lua: false })
    assert.match(r.cmd, /,loadtime,assetloadtime,file$/)
    const badPreset = await call('ue_perf', { action: 'start', kind: 'trace', preset: 'nope' })
    assert.ok(badPreset.isError && /animation/.test(text(badPreset)), text(badPreset))
    // 项目设置关掉后默认不录
    await api('POST', '/p/p1/settings', { perfLua: { on: false, c: true } })
    r = await traceStart({ label: 'off' })
    assert.ok(!/\blua\b/.test(r.cmd), r.cmd)
    await api('POST', '/p/p1/settings', { perfLua: null })

    // ---------- Agent 分析 trace（「UE 性能分析 MCP 接口」设计稿：diagnose、hitches、bound、record / wait、compare、export） ----------
    writeFileSync(cardFile, JSON.stringify({ ...card, bridge: '2.11.0' }))
    const cap = async (args) => {
      const r = await call('ue_capture', args)
      assert.ok(!r.isError, `${JSON.stringify(args)}：${text(r)}`)
      assert.ok(text(r).length <= 12000, `${args.what ?? args.action} 结果太长：${text(r).length}`)
      return JSON.parse(text(r))
    }
    const rec = JSON.parse(
      text(
        await call(
          'ue_perf',
          {
            action: 'record',
            label: 'bag',
            lua: false,
            steps: [
              { mark: 'OpenBag', shot: true },
              { console: 'stat unit' },
              { wait: 0.2 },
              { gm: 'OpenBag' },
              { mark: 'CloseBag' },
            ],
          },
          yes,
        ),
      ),
    )
    assert.ok(rec.capture?.id && rec.analysis?.analyzed, JSON.stringify(rec))
    assert.ok(rec.steps.every((x) => x.ok) && rec.steps.length === 5, JSON.stringify(rec.steps))
    const tid = rec.capture.id
    assert.equal((await cap({ action: 'query', id: tid, what: 'screenshots' })).count, 1)
    const waited = JSON.parse(text(await call('ue_perf', { action: 'wait', id: tid, timeoutMs: 2000 })))
    assert.equal(waited.analyzed, true)
    // 诊断：卡顿按元凶分组（假 trace 的卡顿主要是 Lua 放大），每条带 impactMs 排好序，给出并行方向
    const dg = await cap({ action: 'diagnose', id: tid })
    assert.ok(dg.frames.hitches >= 3, JSON.stringify(dg.frames))
    assert.equal(Object.keys(dg.bound)[0], 'game', JSON.stringify(dg.bound))
    assert.ok(
      dg.findings.some((x) => x.kind === 'hitch' && x.title.startsWith('Lua')),
      JSON.stringify(dg.findings),
    )
    for (let i = 1; i < dg.findings.length; i++)
      assert.ok(dg.findings[i - 1].impactMs >= (dg.findings[i].impactMs ?? 0))
    assert.ok(
      dg.drill.some((x) => x.focus === 'lua'),
      JSON.stringify(dg.drill),
    )
    const hh = await cap({ action: 'query', id: tid, what: 'hitches' })
    assert.equal(hh.items.items[0].frame, 300, '最慢的是第 300 帧')
    assert.equal(hh.items.items[0].culprit, 'Lua')
    assert.ok(
      hh.items.items[0].grew.some((g) => g.src && /AIUtil|BagPanel|ItemSlot|BP_Player|ABP_AI|WBP_HUD/.test(g.src)),
    )
    const bd = await cap({ action: 'query', id: tid, what: 'bound' })
    assert.ok(bd.share.game > 0.9, JSON.stringify(bd))
    const th = await cap({ action: 'query', id: tid, what: 'threads' })
    assert.equal(th.threads[0].name, 'GameThread')
    const fr = await cap({ action: 'query', id: tid, what: 'frame', frame: 300 })
    assert.equal(fr.bound, 'game')
    assert.ok(fr.grew.length && fr.lanes.length >= 3, JSON.stringify(fr).slice(0, 400))
    // 线程按名字找：GameThread 唯一；「Worker」对得上两条要报错列出候选，不悄悄挑一个
    const gtTimers = await cap({ action: 'query', id: tid, what: 'timers', lane: 'GameThread', perFrame: true })
    assert.ok(gtTimers.items.every((x) => x.name !== 'TaskGraph Task') && gtTimers.items[0].perFrameMs > 0)
    const amb = await call('ue_capture', { action: 'query', id: tid, what: 'timers', lane: 'Worker' })
    assert.ok(amb.isError && /好几条线程/.test(text(amb)), text(amb))
    assert.ok(
      (await cap({ action: 'query', id: tid, what: 'instances', timer: 'AIUtil:FindPath' })).items[0].frame >= 0,
    )
    assert.ok((await cap({ action: 'query', id: tid, what: 'events', frame: 300, minMs: 1 })).count > 0)
    const cs = await cap({ action: 'query', id: tid, what: 'counters', sort: 'growth' })
    assert.equal(cs.total, 4)
    for (let i = 1; i < cs.items.length; i++)
      assert.ok(cs.items[i - 1].growth >= cs.items[i].growth, JSON.stringify(cs.items))
    assert.equal((await cap({ action: 'query', id: tid, what: 'log', verbosity: 'Warning' })).count, 1)
    assert.equal((await cap({ action: 'query', id: tid, what: 'session' })).has.lua, true)
    const noTask = await call('ue_capture', { action: 'query', id: tid, what: 'tasks' })
    assert.ok(noTask.isError && /task 通道/.test(text(noTask)), text(noTask))
    // 对比：同一份比自己，变化都是 0；导出写文件只回路径
    const cmpT = await cap({ action: 'compare', id: tid, other: tid })
    assert.equal(cmpT.frames.avgMs[2], 0)
    assert.equal(cmpT.worse.length, 0)
    const ex = await cap({ action: 'export', id: tid, what: 'frames' })
    assert.ok(existsSync(ex.file) && ex.rows === 600 && ex.columns.includes('GameThread'), JSON.stringify(ex))
    // 旧桥接（没有 framestats / framediff）：面板用 timing 和逐帧 timers 兜底，照样能诊断，标 approx
    globalThis.__fakeTraceOld = true
    try {
      const rec2 = JSON.parse(
        text(await call('ue_perf', { action: 'record', label: 'old', lua: false, steps: [{ wait: 0.1 }] }, yes)),
      )
      const dg2 = await cap({ action: 'diagnose', id: rec2.capture.id })
      assert.equal(dg2.approx, true)
      assert.equal(Object.keys(dg2.bound)[0], 'game', JSON.stringify(dg2.bound))
      assert.ok(
        dg2.findings.some((x) => x.kind === 'hitch'),
        JSON.stringify(dg2.findings),
      )
      const oldS = await call('ue_capture', { action: 'query', id: rec2.capture.id, what: 'session' })
      assert.ok(oldS.isError && /2\.11\.0/.test(text(oldS)), text(oldS))
    } finally {
      globalThis.__fakeTraceOld = false
    }
    writeFileSync(cardFile, JSON.stringify(card))
    rmSync(path.join(proj, 'Plugins', 'UnLua'), { recursive: true, force: true })
  }

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
  // 先编译后保存：编不过的整批不保存（P4 也不签出），错误交给 Agent
  const brokenSave = await call('ue_save', { packages: ['/Game/Data/BP_Broken', bridge.bp.split('.')[0]] }, yes)
  assert.ok(brokenSave.isError && /整批没有保存/.test(text(brokenSave)), text(brokenSave))
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

  console.log(`ue 冒烟测试通过：22 个工具，操作记录 ${hist.items.length} 条`)
} finally {
  await plugin.stop?.()
  await bridge.stop()
  rmSync(tmp, { recursive: true, force: true })
}
