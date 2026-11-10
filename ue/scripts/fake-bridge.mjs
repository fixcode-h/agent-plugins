// 假的桥接（冒烟测试用）：在本进程里起一个 HTTP 服务，协议和 UE 里的 AgentPanelBridge 一样（GET /info、POST /rpc、令牌头），
// 在 <项目>/Saved/AgentPanel/instances/<PID>.json 写名片。只实现冒烟测试用到的几个操作，状态放在内存里。
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { makeCsv, makeMemReport } from './perf-fixtures.mjs'

export async function startFakeBridge(root, { kind = 'editor' } = {}) {
  const token = 'fake-token'
  const state = {
    seq: 0,
    lines: [],
    hero: { Health: 80, MaxHealth: 120, bInvincible: false },
    cvars: { 't.MaxFPS': '0' },
    calls: [],
    perf: { csv: false, n: 0, mem: 0 },
    // 假的 UnLua 环境：全局表和 GameInstance 的 Lua 实例表
    lua: {
      global: { GameSystemManager: { Count: 3, Name: 'gsm', Players: { 1: 'alice', 2: 'bob' } } },
      inst: { Gold: 100, Ratio: 0.5, Bag: { Size: 20 } },
      exec: [],
    },
  }
  const log = (category, verbosity, text) => state.lines.push({ seq: ++state.seq, category, verbosity, text })
  log('LogInit', 'Display', 'fake bridge up')
  log('LogNet', 'Warning', 'connection timeout (client 2)')
  const HERO = '/Game/Maps/UEDPIE_0_Town.Town:PersistentLevel.BP_Hero_C_1'
  const GI = '/Engine/Transient.GameEngine_0:BP_LuaGameInstance_C_0'
  // 假桥接的 Lua：对象实例表 / 全局表按 keys 往下取（和真桥接一样数字键写成数字）
  const luaRoot = (a) => {
    if (!a.path) return state.lua.global
    if (a.path !== GI) throw new Error(`${a.path} 还没进过 Lua`)
    return state.lua.inst
  }
  const luaWalk = (v, keys) => {
    for (const k of keys) {
      if (typeof v !== 'object' || v === null) throw new Error('不是表')
      v = v[k]
    }
    return v
  }
  const luaDesc = (v) =>
    v === undefined || v === null
      ? { t: 'nil' }
      : typeof v === 'object'
        ? { t: 'table', n: Object.keys(v).length }
        : { t: typeof v, v, ...(Number.isInteger(v) ? { int: true } : {}) }
  const ops = {
    'lua.objects': (a) => ({
      items:
        !a.module || 'Game.Core.GameInstance'.toLowerCase().includes(String(a.module).toLowerCase())
          ? [
              {
                path: GI,
                name: 'BP_LuaGameInstance_C_0',
                class: 'BP_LuaGameInstance_C',
                module: 'Game.Core.GameInstance',
              },
            ]
          : [],
      more: false,
      bound: 1,
    }),
    'lua.get': (a) => {
      const v = luaWalk(luaRoot(a), a.keys ?? [])
      const out = { value: luaDesc(v) }
      if (a.path)
        out.object = {
          path: GI,
          name: 'BP_LuaGameInstance_C_0',
          class: 'BP_LuaGameInstance_C',
          module: 'Game.Core.GameInstance',
          bound: true,
        }
      if (typeof v === 'object' && v !== null) {
        const keys = Object.keys(v)
        out.fields = keys.map((k) => ({
          k,
          kt: /^\d+$/.test(k) ? 'number' : 'string',
          ...(/^\d+$/.test(k) ? { kn: Number(k) } : {}),
          ...luaDesc(v[k]),
        }))
        out.total = keys.length
        out.more = false
        if (a.path && !(a.keys ?? []).length)
          out.functions = [{ name: 'ReceiveBeginPlay', src: 'Game/Core/GameInstance.lua:12' }]
      }
      return out
    },
    'lua.set': (a) => {
      const keys = a.keys ?? []
      const parent = luaWalk(luaRoot(a), keys.slice(0, -1))
      const k = keys[keys.length - 1]
      const prev = parent[k] ?? null
      if (typeof prev === 'object' && prev !== null) throw new Error('只能改数字、字符串、布尔或 nil 的字段')
      parent[k] = a.value
      return { prev, value: a.value, type: luaDesc(a.value).t }
    },
    'lua.exec': (a) => {
      state.lua.exec.push(a.code)
      if (/error\(/.test(a.code)) throw new Error('[string "AgentPanel"]:1: boom')
      return { results: [{ t: 'number', v: 42, int: true }], output: ['hello'], ms: 0.3 }
    },
    console: (a) => {
      state.calls.push(a.command)
      log('LogConsole', 'Log', `ran ${a.command}`)
      // 性能抓取：和引擎一样把文件写进 Saved/Profiling，不在输出里说写到哪了（面板要自己找新文件）
      const prof = path.join(root, 'Saved', 'Profiling')
      if (/^csvprofile start/i.test(a.command)) state.perf.csv = true
      if (/^csvprofile stop/i.test(a.command) && state.perf.csv) {
        state.perf.csv = false
        mkdirSync(path.join(prof, 'CSV'), { recursive: true })
        writeFileSync(path.join(prof, 'CSV', `Profile(${++state.perf.n}).csv`), makeCsv())
      }
      if (/^memreport/i.test(a.command)) {
        const dir = path.join(prof, 'MemReports', 'Fake-Windows-01.01-00.00.00')
        mkdirSync(dir, { recursive: true })
        // 第二份起背包控件多 40 个：模拟进出场景后没释放
        const extra = state.perf.mem++ ? { WBP_Bag_C: 40 } : {}
        writeFileSync(path.join(dir, `Town-${state.perf.mem}.memreport`), makeMemReport({ extra }))
      }
      return { output: [`ran ${a.command}`], world: 'pie0' }
    },
    cvars: () => ({
      items: Object.entries(state.cvars).map(([name, value]) => ({
        name,
        kind: 'var',
        value,
        setBy: 'Console',
        help: '',
      })),
      total: 1,
    }),
    'cvar.set': (a) => {
      const prev = state.cvars[a.name]
      state.cvars[a.name] = String(a.value)
      return { prev, prevSetBy: 'Constructor', value: state.cvars[a.name] }
    },
    'gm.list': () => ({
      items: [
        {
          name: 'God',
          owner: 'CheatManager',
          category: 'Cheat',
          tooltip: '',
          source: 'exec',
          server: false,
          params: [],
        },
      ],
    }),
    'gm.run': (a) => ({ output: [`gm ${a.name}`] }),
    actors: (a) => ({
      items: 'BP_Hero_C_1'.toLowerCase().startsWith(String(a.prefix).toLowerCase())
        ? [{ path: HERO, name: 'BP_Hero_C_1', class: 'BP_Hero_C', label: 'BP_Hero', level: 'Town', player: true }]
        : [],
      more: false,
      world: 'pie0',
    }),
    components: (a) => ({
      items:
        a.path === HERO
          ? [
              {
                path: `${HERO}.CapsuleComponent`,
                name: 'CapsuleComponent',
                class: 'CapsuleComponent',
                parent: '',
                root: true,
              },
              {
                path: `${HERO}.Mesh`,
                name: 'Mesh',
                class: 'SkeletalMeshComponent',
                parent: `${HERO}.CapsuleComponent`,
                root: false,
              },
              { path: `${HERO}.Health`, name: 'Health', class: 'BP_HealthComponent_C', parent: '', root: false },
            ]
          : [],
    }),
    props: (a) => {
      if (a.path !== HERO) throw new Error(`找不到对象 ${a.path}`)
      return {
        object: { path: HERO, name: 'BP_Hero_C_1', class: 'BP_Hero_C' },
        props: Object.entries(state.hero).map(([name, value]) => ({
          name,
          type: typeof value === 'boolean' ? 'bool' : 'float',
          value,
        })),
      }
    },
    get: (a) => ({ value: state.hero[a.prop], type: 'float' }),
    set: (a) => {
      if (!(a.prop in state.hero)) throw new Error(`没有属性 ${a.prop}`)
      const prev = state.hero[a.prop]
      state.hero[a.prop] = a.value
      return { prev, value: a.value, asset: false, replicated: true, client: false }
    },
    'log.tail': (a) => {
      const since = Number(a.since) || 0
      const lines = state.lines.filter((l) => l.seq > since && (!a.contains || l.text.includes(a.contains)))
      return {
        lines,
        cursor: state.seq,
        dropped: 0,
        errors: 0,
        warnings: 1,
        file: path.join(root, 'Saved', 'Logs', 'Fake.log'),
      }
    },
    'log.clear': () => {
      const size = state.lines.length
      state.lines = []
      log('LogAgentPanel', 'Display', 'cleared')
      return { file: path.join(root, 'Saved', 'Logs', 'Fake.log'), size, backup: '', cursor: state.seq }
    },
    screenshot: () => ({ png: 'iVBORw0KGgo=', width: 1, height: 1, world: 'pie0' }),
  }
  const server = createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.headers['x-agentpanel-token'] !== token) return send(401, { ok: false, error: 'bad token' })
    if (req.method === 'GET' && req.url === '/info')
      return send(200, {
        ok: true,
        kind,
        pid: process.pid,
        log: path.join(root, 'Saved', 'Logs', 'Fake.log'),
        lua: { available: true, version: 'Lua 5.4.6' },
        worlds: [
          { id: 'editor', type: 'Editor', netMode: 'Standalone', map: 'Town' },
          { id: 'pie0', type: 'PIE', netMode: 'ListenServer', pieInstance: 0, map: 'Town' },
        ],
      })
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      try {
        const { op, args } = JSON.parse(body)
        if (!ops[op]) return send(200, { ok: false, error: `不认识的操作 ${op}` })
        send(200, { ok: true, ...ops[op](args ?? {}) })
      } catch (e) {
        send(200, { ok: false, error: e.message })
      }
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const dir = path.join(root, 'Saved', 'AgentPanel', 'instances')
  mkdirSync(dir, { recursive: true })
  const card = path.join(dir, `${process.pid}.json`)
  writeFileSync(
    card,
    JSON.stringify({
      pid: process.pid,
      port,
      token,
      kind,
      engine: '5.4.4',
      bridge: '1.0.0',
      project: root,
      startedAt: new Date().toISOString(),
    }),
  )
  return {
    state,
    hero: HERO,
    gi: GI,
    stop: () => {
      rmSync(card, { force: true })
      return new Promise((r) => server.close(r))
    },
  }
}
