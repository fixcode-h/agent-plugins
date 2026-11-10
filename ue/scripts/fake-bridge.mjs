// 假的桥接（冒烟测试用）：在本进程里起一个 HTTP 服务，协议和 UE 里的 AgentPanelBridge 一样（GET /info、POST /rpc、令牌头），
// 在 <项目>/Saved/AgentPanel/instances/<PID>.json 写名片。只实现冒烟测试用到的几个操作，状态放在内存里。
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'

export async function startFakeBridge(root, { kind = 'editor' } = {}) {
  const token = 'fake-token'
  const state = {
    seq: 0,
    lines: [],
    hero: { Health: 80, MaxHealth: 120, bInvincible: false },
    cvars: { 't.MaxFPS': '0' },
    calls: [],
  }
  const log = (category, verbosity, text) => state.lines.push({ seq: ++state.seq, category, verbosity, text })
  log('LogInit', 'Display', 'fake bridge up')
  log('LogNet', 'Warning', 'connection timeout (client 2)')
  const HERO = '/Game/Maps/UEDPIE_0_Town.Town:PersistentLevel.BP_Hero_C_1'
  const ops = {
    console: (a) => {
      state.calls.push(a.command)
      log('LogConsole', 'Log', `ran ${a.command}`)
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
    stop: () => {
      rmSync(card, { force: true })
      return new Promise((r) => server.close(r))
    },
  }
}
