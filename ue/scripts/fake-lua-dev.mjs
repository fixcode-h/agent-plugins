// 假桥接里 UELink 2.4 的操作（冒烟测试用）：编辑器选中同步、Lua 改完能验、Lua 对象检视和调函数。
// 单独一个文件，免得几个工作包同时改 fake-bridge.mjs 的同一段
export function luaDevOps({ state, hero, gi, bp, luaRoot, luaWalk, luaDesc }) {
  state.lua.modules = [
    { name: 'Game.Core.GameInstance', file: 'Content/Script/Game/Core/GameInstance.lua', objects: 1, stale: false },
    { name: 'UI.BagPanel', file: 'Content/Script/UI/BagPanel.lua', objects: 2, stale: true },
  ]
  state.lua.errors = []
  state.lua.errSeq = 0
  state.selection = {
    actors: [{ path: hero, name: 'BP_Hero_C_1', label: 'Hero', class: 'BP_Hero_C', world: 'pie0' }],
    actorCount: 1,
    assets: [{ path: `${bp}.BP_Hero`, name: 'BP_Hero', class: 'Blueprint' }],
    folders: [],
  }
  state.selected = []
  const fns = [
    { name: 'AddGold', from: 0, params: ['self', 'n'], vararg: false, src: 'Game/Core/GameInstance.lua:20' },
    { name: 'ReceiveBeginPlay', from: 1, params: ['self'], vararg: false, src: 'Game/Core/GameInstance.lua:12' },
  ]
  return {
    'editor.selection': () => ({
      ...state.selection,
      blueprint: { path: bp, graph: 'EventGraph', nodes: [{ id: 'a1b2c3d4', title: 'Event BeginPlay' }] },
    }),
    'editor.select': (a) => {
      state.selected = [...(a.actors ?? []), ...(a.assets ?? [])]
      return { actors: (a.actors ?? []).length, assets: (a.assets ?? []).length, missing: [] }
    },
    'lua.check': (a) => {
      const errors = []
      if (/syntax error/.test(a.code ?? '')) errors.push({ file: a.name ?? 'code', line: 1, message: "'=' expected near 'error'" })
      for (const f of a.files ?? []) if (/Bad/.test(f)) errors.push({ file: f, line: 3, message: "'end' expected near <eof>" })
      return { passed: !errors.length, checked: (a.files ?? []).length + (a.code ? 1 : 0), errors }
    },
    'lua.modules': (a) => {
      const items = state.lua.modules.filter((m) => !a.filter || m.name.toLowerCase().includes(String(a.filter).toLowerCase()))
      return { items, total: items.length, stale: items.filter((m) => m.stale).length, root: 'Content/Script', reloader: false }
    },
    'lua.reload': (a) => {
      const names = a.changed ? state.lua.modules.filter((m) => m.stale).map((m) => m.name) : (a.modules ?? [])
      if (!names.length) throw new Error('没有改过还没重载的模块')
      const items = names.map((n) => {
        const m = state.lua.modules.find((x) => x.name === n)
        if (!m) return { module: n, ok: false, mode: 'require', error: `module '${n}' not found` }
        m.stale = false
        return { module: n, ok: true, mode: 'require' }
      })
      return { items, failed: items.filter((i) => !i.ok).length, note: '用 require 兜底重载' }
    },
    'lua.errors': (a) => {
      if (a.clear) state.lua.errors = []
      const since = Number(a.since) || 0
      return { items: state.lua.errors.filter((e) => e.seq > since), seq: state.lua.errSeq, total: state.lua.errors.length }
    },
    'lua.inspect': (a) => {
      const v = luaWalk(luaRoot(a), a.keys ?? [])
      const out = { value: luaDesc(v) }
      if (typeof v === 'object' && v !== null) {
        out.fields = Object.keys(v).map((k) => ({ k, kt: 'string', ...luaDesc(v[k]) }))
        out.total = out.fields.length
        out.more = false
        out.chain = a.path ? [{ name: 'Game.Core.GameInstance', src: 'Game/Core/GameInstance.lua:12' }] : []
        out.functions = a.path ? fns : []
        out.upvalues = a.path ? [{ fn: 'AddGold', name: 'MAX_GOLD', index: 1, t: 'number', v: 9999, int: true }] : []
      }
      return out
    },
    'lua.call': (a) => {
      const keys = a.keys ?? []
      const parent = luaWalk(luaRoot(a), keys.slice(0, -1))
      const name = keys[keys.length - 1]
      if (name !== 'AddGold' || typeof parent !== 'object') throw new Error(`${name} 是 nil，不是函数`)
      const before = parent.Gold
      parent.Gold += Number((a.args ?? [])[0] ?? 0)
      return {
        results: [{ t: 'number', v: parent.Gold, int: true }],
        output: [],
        ms: 0.2,
        ...(a.self ? { changes: [{ k: 'Gold', before, after: parent.Gold }] } : {}),
      }
    },
  }
}

/** 往假桥接里塞一条 Lua 报错（同一处再来一次就加次数） */
export function fakeLuaError(state, message, where) {
  const hit = state.lua.errors.find((e) => e.message === message)
  const now = new Date().toISOString()
  state.lua.errSeq++
  if (hit) {
    hit.count++
    hit.last = now
    hit.seq = state.lua.errSeq
    return
  }
  state.lua.errors.push({
    id: `e${state.lua.errSeq}`,
    message,
    where,
    count: 1,
    first: now,
    last: now,
    stack: [`${where}: in function 'OnClick'`],
    locals: [{ name: 'item', t: 'nil' }],
    source: 'capture',
    seq: state.lua.errSeq,
  })
}
