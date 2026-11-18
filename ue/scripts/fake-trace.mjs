// 假桥接的 trace.query（截图和冒烟用）：手写一份带 Lua 计时器的 trace，回包形状照 UELink 的 AgentPanelTrace.cpp
// （info / frames / timing / timers / butterfly / stack / instances / counters / log / bookmarks，以及 2.9.0 的 luainfo / tree）。
// 不读真的 .utrace：每帧按同一棵作用域树生成，少数几帧放大（卡顿），Lua 函数带文件和行号、C 函数文件是 <lua:C>。

const NAMES = {
  1: 'FEngineLoop::Tick',
  2: 'UEditorEngine::Tick',
  3: 'UWorld::Tick',
  4: 'TG_PrePhysics',
  5: 'BP_PlayerController_C Tick',
  6: 'UnLua.Call',
  7: 'BP_PlayerController_C:ReceiveTick',
  8: 'BagPanel:Refresh',
  9: 'ItemSlot:SetData',
  10: 'UE.Load',
  11: 'lua.string.format',
  12: 'ABP_AICharacter_C UpdateAnimation',
  13: 'ABP_AICharacter_C:BlueprintUpdateAnimation',
  14: 'AIUtil:FindPath',
  15: 'AIUtil:Heuristic',
  16: 'UE.GetVelocity',
  17: 'TG_PostUpdateWork',
  18: 'WBP_HUD_C:Tick',
  19: 'FSlateApplication::Tick',
  20: 'FRenderingThread::Tick',
  21: 'FDeferredShadingSceneRenderer::Render',
  22: 'InitViews',
  23: 'RHI Submit',
  24: 'BasePass',
  25: 'Lighting',
  26: 'TaskGraph Task',
}
const LUA = {
  7: ['Player/BP_PlayerController_C.lua', 42],
  8: ['UI/BagPanel.lua', 88],
  9: ['UI/ItemSlot.lua', 31],
  13: ['Animation/ABP_AICharacter_C.lua', 18],
  14: ['AI/AIUtil.lua', 96],
  15: ['AI/AIUtil.lua', 140],
  18: ['UI/WBP_HUD_C.lua', 12],
}
const CFN = [10, 11, 16]
const GPU = new Set([24, 25])

// 一帧的作用域树：[计时器, 自身毫秒, 子节点, 重复次数]
const n = (t, self, kids = [], times = 1) => ({ t, self, kids, times })
const GAME = n(1, 0.3, [
  n(2, 0.4, [
    n(3, 0.5, [
      n(4, 0.6, [
        n(5, 0.1, [n(6, 0.1, [n(7, 0.4, [n(8, 0.5, [n(9, 0.25, [n(10, 0.12)], 6), n(11, 0.06, [], 2)])])])]),
        n(12, 0.1, [n(6, 0.1, [n(13, 0.4, [n(14, 0.6, [n(15, 0.18, [], 8), n(16, 0.08)])])])]),
      ]),
      n(17, 0.4, [n(6, 0.1, [n(18, 0.6, [n(11, 0.05)])])]),
    ]),
    n(19, 1.6),
  ]),
])
const RENDER = n(20, 0.5, [n(21, 1.2, [n(22, 2.0)])])
const RHI = n(23, 3.5)
const GPUT = n(24, 4.2, [n(25, 2.6)])
const WORKER = n(26, 0.8, [], 3)

const FRAMES = 600
const SPIKES = { 120: 3.4, 121: 2, 200: 2.8, 300: 5, 301: 1.8, 455: 3.6, 520: 3 }
const LANES = [
  { id: -1, name: 'GPU', group: 'GPU', tree: GPUT },
  { id: 2, name: 'GameThread', group: '', tree: GAME },
  { id: 3, name: 'RenderThread 1', group: '', tree: RENDER },
  { id: 4, name: 'RHIThread', group: '', tree: RHI },
  { id: 11, name: 'Foreground Worker #0', group: 'TaskGraph', tree: WORKER },
  { id: 12, name: 'Foreground Worker #1', group: 'TaskGraph', tree: WORKER },
]
const totalOf = (x, k, lua) =>
  x.times * (x.self * (LUA[x.t] || CFN.includes(x.t) ? lua : k) + x.kids.reduce((s, c) => s + totalOf(c, k, lua), 0))

/** 摊平一帧一条泳道：每个事件 { s 秒, ms, d, t, x 独占 ms, p 父事件下标 } */
function layout(tree, start, k, lua) {
  const out = []
  const walk = (x, s, d, p) => {
    let cur = s
    for (let r = 0; r < x.times; r++) {
      const self = x.self * (LUA[x.t] || CFN.includes(x.t) ? lua : k)
      const ms = totalOf({ ...x, times: 1 }, k, lua)
      const me = out.length
      out.push({ s: cur, ms, d, t: x.t, x: self, p })
      // 自身时间一半放在孩子前面，一半在后面，块看起来像真的调用
      let c = cur + self / 2000
      for (const kid of x.kids) c = walk(kid, c, d + 1, me)
      cur += ms / 1000
    }
    return cur
  }
  walk(tree, start, 0, -1)
  return out
}

function build(root) {
  const start = []
  const ms = []
  const events = new Map(LANES.map((l) => [l.id, []]))
  const counters = { 'Lua/FrameMs': [], 'Lua/Calls': [], 'Lua/MemoryKB': [], 'RHI/DrawCalls': [] }
  let t = 0
  let mem = 47800
  for (let i = 0; i < FRAMES; i++) {
    const spike = SPIKES[i] ?? 1
    const wob = 1 + ((i * 37) % 11) / 60
    const k = (spike > 1 ? 1 + (spike - 1) * 0.4 : 1) * wob
    const lua = spike * wob
    let frameMs = 0
    for (const l of LANES) {
      const ev = layout(l.tree, t + 0.0002, k, lua)
      events.get(l.id).push(...ev.map((e) => ({ ...e, f: i })))
      if (l.id === 2) frameMs = ev[0].ms + 3.2
    }
    start.push(t)
    ms.push(frameMs)
    // Lua 计数器在帧结束时发，时间点落在下一帧开头
    const luaMs = events
      .get(2)
      .filter((e) => e.f === i && (e.t === 7 || e.t === 13 || e.t === 18))
      .reduce((s, e) => s + e.ms, 0)
    const at = t + frameMs / 1000
    mem += i % 97 === 96 ? -1100 : 2.6
    counters['Lua/FrameMs'].push([at, luaMs])
    counters['Lua/Calls'].push([at, Math.round(4800 * lua + (i % 13) * 7)])
    counters['Lua/MemoryKB'].push([at, Math.round(mem)])
    counters['RHI/DrawCalls'].push([at, 1800 + (i % 9) * 12])
    t = at
  }
  const luaTimers = {}
  for (const [id, [f, line]] of Object.entries(LUA)) luaTimers[id] = { file: `${root}/Content/Script/${f}`, line }
  for (const id of CFN) luaTimers[id] = { file: '<lua:C>', line: 0, c: true }
  return { start, ms, events, counters, duration: t, luaTimers }
}

const r3 = (x) => Math.round(x * 1000) / 1000

export function traceOps(root) {
  let T
  const get = () => (T ??= build(root.replaceAll('\\', '/')))
  const base = () => ({ analyzing: false, duration: get().duration })
  const inRange = (a, e) => {
    const t0 = a.t0 ?? 0
    const t1 = a.t1 ?? Infinity
    return e.s < t1 && e.s + e.ms / 1000 > t0
  }
  const isLua = (id) => !!get().luaTimers[id]
  const isC = (id) => !!get().luaTimers[id]?.c
  /** 合并同一路径的事件：返回树节点 { id, name, count, incl, excl, children } */
  const agg = (list, lane, mergeC) => {
    const node = (id) => ({ id, name: NAMES[id] ?? `#${id}`, count: 0, incl: 0, excl: 0, kids: new Map() })
    const add = (into, e, all) => {
      let me = into.kids.get(e.t)
      if (!me) into.kids.set(e.t, (me = node(e.t)))
      me.count++
      me.incl += e.ms
      me.excl += e.x
      for (const c of all.childrenOf(e)) {
        if (mergeC && isC(c.t)) me.excl += c.ms
        else add(me, c, all)
      }
    }
    return { node, add }
  }
  const index = (ev) => {
    const kids = new Map()
    ev.forEach((e, i) => {
      if (e.p < 0) return
      // p 是同一帧里的下标：按帧分组后换成全局下标
      const key = `${e.f}:${e.p}`
      if (!kids.has(key)) kids.set(key, [])
      kids.get(key).push(e)
    })
    const local = new Map()
    let f = -1
    let off = 0
    ev.forEach((e, i) => {
      if (e.f !== f) {
        f = e.f
        off = i
      }
      local.set(e, i - off)
    })
    return { childrenOf: (e) => kids.get(`${e.f}:${local.get(e)}`) ?? [] }
  }
  const idx = new Map()
  const lanesIdx = (id) => {
    if (!idx.has(id)) idx.set(id, index(get().events.get(id)))
    return idx.get(id)
  }
  const out = (n, depth = 0) => {
    const kids = [...n.kids.values()].sort((a, b) => b.incl - a.incl)
    return {
      id: n.id,
      name: n.name,
      count: n.count,
      incl: r3(n.incl),
      excl: r3(n.excl),
      children: depth < 12 ? kids.slice(0, 20).map((k) => out(k, depth + 1)) : [],
      ...(kids.length > 20 ? { more: kids.length - 20 } : {}),
    }
  }
  const sumRoot = (r) => {
    let incl = 0
    for (const k of r.kids.values()) incl += k.incl
    r.incl = incl
    return r
  }

  /** 每帧每条泳道深度 0 的块（和桥接 framestats 一样）、每帧每个计时器的独占时间（framediff 用） */
  const perFrame = () => {
    const D = get()
    if (D.pf) return D.pf
    const busy = new Map(
      LANES.filter((l) => l.id !== 11 && l.id !== 12).map((l) => [l.id, new Array(D.start.length).fill(0)]),
    )
    // 每帧每条泳道每个计时器的独占时间：excl[帧] = Map(泳道 → Map(计时器 → 毫秒))
    const excl = D.start.map(() => new Map())
    for (const [lane, list] of D.events)
      for (const e of list) {
        if (e.d === 0 && busy.has(lane)) busy.get(lane)[e.f] += e.ms
        if (!excl[e.f].has(lane)) excl[e.f].set(lane, new Map())
        const m = excl[e.f].get(lane)
        m.set(e.t, (m.get(e.t) ?? 0) + e.x)
      }
    return (D.pf = { busy, excl })
  }
  const v211 = (a, D) => {
    const { busy, excl } = perFrame()
    switch (a.what) {
      case 'framestats':
        return {
          ...base(),
          type: 'game',
          f0: 0,
          count: D.start.length,
          total: D.start.length,
          ms: D.ms.map(r3),
          lanes: [...busy].map(([id, b]) => ({ id, name: LANES.find((l) => l.id === id).name, busy: b.map(r3) })),
        }
      case 'framediff': {
        const order = D.ms.map((ms, i) => [ms, i]).sort((x, y) => x[0] - y[0])
        const baseF = order
          .slice(Math.floor(order.length * 0.4), Math.floor(order.length * 0.6))
          .slice(0, 120)
          .map((x) => x[1])
        const of = (f) => {
          const m = new Map()
          for (const [lane, ts] of excl[f])
            if (!a.lanes || a.lanes.includes(lane)) for (const [t, v] of ts) m.set(t, (m.get(t) ?? 0) + v)
          return m
        }
        const avg = new Map()
        for (const f of baseF) for (const [t, v] of of(f)) avg.set(t, (avg.get(t) ?? 0) + v / baseF.length)
        return {
          ...base(),
          base: { frames: baseF.length, ms: r3(baseF.reduce((s, f) => s + D.ms[f], 0) / baseF.length) },
          frames: a.frames.map((f) => ({
            frame: f,
            start: D.start[f],
            ms: r3(D.ms[f]),
            items: [...of(f)]
              .map(([t, v]) => ({ t, v, b: avg.get(t) ?? 0 }))
              .filter((x) => x.v > x.b)
              .sort((x, y) => y.v - y.b - (x.v - x.b))
              .slice(0, a.top ?? 8)
              .map((x) => {
                const lx = D.luaTimers[x.t]
                return {
                  id: x.t,
                  name: NAMES[x.t],
                  excl: r3(x.v),
                  base: r3(x.b),
                  ...(GPU.has(x.t) ? { gpu: true } : {}),
                  ...(lx ? { file: lx.file, line: lx.line, ...(lx.c ? { c: true } : {}) } : {}),
                }
              }),
          })),
        }
      }
      case 'session':
        return {
          ...base(),
          name: 'Fake',
          platform: 'Windows',
          gameFrames: D.start.length,
          renderFrames: 0,
          threads: LANES.length,
          counters: Object.keys(D.counters).length,
          has: {
            cpu: true,
            gpu: true,
            lua: true,
            regions: false,
            memtags: false,
            allocs: false,
            loads: false,
            files: false,
            tasks: false,
            switches: false,
            net: false,
          },
        }
      default:
        // 没录对应通道：和桥接一样回错误并说明要开什么
        throw new Error('这份 trace 没有任务数据：录制时要开 task 通道（或用 preset=task）')
    }
  }

  return {
    'trace.query': (a) => {
      const D = get()
      switch (a.what) {
        case 'info':
          return {
            ...base(),
            frames: D.start.length,
            lua: true,
            threads: LANES.map(({ id, name, group }) => ({ id, name, group })),
          }
        case 'frames':
          return { ...base(), start: D.start, ms: D.ms.map(r3), total: D.start.length }
        case 'bookmarks':
          return {
            ...base(),
            items: [
              { t: D.start[118], text: 'OpenBag' },
              { t: D.start[298], text: 'SpawnAI' },
            ],
          }
        case 'log':
          return {
            ...base(),
            total: 3,
            items: [
              { t: D.start[118], v: 'Display', c: 'LogUnLua', m: 'BagPanel opened' },
              { t: D.start[300], v: 'Warning', c: 'LogAI', m: 'FindPath took too long' },
              { t: D.start[455], v: 'Display', c: 'LogUnLua', m: 'GC step' },
            ].filter((x) => inRange(a, { s: x.t, ms: 0 }) || (a.t0 === undefined && a.t1 === undefined)),
          }
        case 'luainfo':
          return { ...base(), lua: true, timers: D.luaTimers }
        case 'counters': {
          if (!a.names && a.stats && !globalThis.__fakeTraceOld)
            return {
              ...base(),
              counters: Object.entries(D.counters).map(([name, pts]) => {
                const vs = pts.filter(([t]) => t >= (a.t0 ?? 0) && t <= (a.t1 ?? Infinity))
                const v = vs.map((x) => x[1])
                return {
                  name,
                  n: v.length,
                  min: Math.min(...v),
                  max: Math.max(...v),
                  avg: v.reduce((s, x) => s + x, 0) / v.length,
                  first: v[0],
                  last: v.at(-1),
                  firstT: vs[0][0],
                  lastT: vs.at(-1)[0],
                }
              }),
            }
          if (!a.names) return { ...base(), counters: Object.keys(D.counters).map((name) => ({ name })) }
          const t0 = a.t0 ?? 0
          const t1 = a.t1 ?? D.duration
          const px = Math.max(10, Math.min(4000, a.px ?? 600))
          const step = (t1 - t0) / px
          const series = a.names
            .filter((nm) => D.counters[nm])
            .map((name) => {
              const t = []
              const v = []
              for (const [at, val] of D.counters[name]) {
                if (at < t0 || at > t1) continue
                const slot = Math.floor((at - t0) / step)
                if (t.length && Math.floor((t.at(-1) - t0) / step) === slot) v[v.length - 1] = Math.max(v.at(-1), val)
                else {
                  t.push(at)
                  v.push(val)
                }
              }
              return { name, t, v }
            })
          return { ...base(), series }
        }
        case 'timing': {
          const lanes = (a.lanes ?? LANES.map((l) => l.id)).filter((id) => D.events.has(id))
          const min = (((a.t1 ?? D.duration) - (a.t0 ?? 0)) / (a.px ?? 1200)) * 0.5 * 1000
          const used = new Set()
          const res = lanes.map((id) => {
            const ev = D.events.get(id).filter((e) => inRange(a, e) && e.ms >= min)
            ev.forEach((e) => used.add(e.t))
            return {
              id,
              s: ev.map((e) => e.s),
              ms: ev.map((e) => r3(e.ms)),
              d: ev.map((e) => e.d),
              t: ev.map((e) => e.t),
              x: ev.map((e) => r3(e.x)),
              hidden: 0,
            }
          })
          return {
            ...base(),
            lanes: res,
            names: Object.fromEntries([...used].map((id) => [String(id), NAMES[id]])),
            cut: false,
          }
        }
        case 'timers': {
          const rows = new Map()
          for (const [lane, list] of D.events) {
            if (a.lanes && !a.lanes.includes(lane)) continue
            const ix = lanesIdx(lane)
            for (const e of list) {
              if (!inRange(a, e)) continue
              if (a.lua && !isLua(e.t)) continue
              if (a.mergeC && isC(e.t)) continue
              let r = rows.get(e.t)
              if (!r) rows.set(e.t, (r = { id: e.t, name: NAMES[e.t], count: 0, incl: 0, inclMax: 0, excl: 0 }))
              r.count++
              r.incl += e.ms
              r.inclMax = Math.max(r.inclMax, e.ms)
              r.excl += e.x
              if (a.mergeC && isLua(e.t)) for (const c of ix.childrenOf(e)) if (isC(c.t)) r.excl += c.ms
            }
          }
          const key = { count: 'count', incl: 'incl', excl: 'excl', max: 'inclMax' }[a.sort] ?? 'excl'
          const q = String(a.filter ?? '').toLowerCase()
          const all = [...rows.values()]
            .filter((r) => !q || r.name.toLowerCase().includes(q))
            .sort((x, y) => y[key] - x[key])
          const items = all.slice(0, a.top ?? 200).map((r) => {
            const lx = D.luaTimers[r.id]
            return {
              ...r,
              incl: r3(r.incl),
              excl: r3(r.excl),
              inclMax: r3(r.inclMax),
              ...(GPU.has(r.id) ? { gpu: true } : {}),
              ...(lx ? { file: lx.file, line: lx.line, ...(lx.c ? { c: true } : {}) } : {}),
            }
          })
          return { ...base(), items, total: all.length, seconds: (a.t1 ?? D.duration) - (a.t0 ?? 0) }
        }
        case 'tree':
        case 'butterfly': {
          const tid = a.what === 'tree' ? a.root : a.timer
          const all = { id: -1, name: '全部', count: 0, incl: 0, excl: 0, kids: new Map() }
          const callers = { id: tid, name: NAMES[tid], count: 0, incl: 0, excl: 0, kids: new Map() }
          for (const [lane, list] of D.events) {
            const ix = lanesIdx(lane)
            const { add } = agg(list, lane, a.mergeC)
            const parents = []
            for (const e of list) {
              if (!inRange(a, e)) continue
              parents[e.d] = e
              if (tid !== undefined) {
                if (e.t !== tid) continue
                add(all, e, ix)
                if (a.what === 'butterfly') {
                  let at = callers
                  at.count++
                  at.incl += e.ms
                  for (let d = e.d - 1; d >= 0; d--) {
                    const p = parents[d]
                    let me = at.kids.get(p.t)
                    if (!me)
                      at.kids.set(
                        p.t,
                        (me = { id: p.t, name: NAMES[p.t], count: 0, incl: 0, excl: 0, kids: new Map() }),
                      )
                    me.count++
                    me.incl += e.ms
                    at = me
                  }
                }
              } else if (a.luaOnly) {
                // 最外层的 Lua：父链上没有别的 Lua 计时器
                if (!isLua(e.t) || isC(e.t)) continue
                let outer = true
                for (let d = 0; d < e.d; d++) if (isLua(parents[d]?.t)) outer = false
                if (outer) add(all, e, ix)
              } else if (e.d === 0) add(all, e, ix)
            }
          }
          if (a.what === 'tree') {
            if (tid !== undefined) {
              // 和桥接一样：根是「全部」，下面只有一个孩子，就是 root 计时器
              for (const k of [...all.kids.keys()]) if (k !== tid) all.kids.delete(k)
              return { ...base(), root: out(sumRoot(all)) }
            }
            return { ...base(), root: out(sumRoot(all)) }
          }
          const callee = all.kids.get(tid)
          return {
            ...base(),
            callers: out(callers),
            callees: callee ? out(callee) : { id: tid, name: NAMES[tid], count: 0, incl: 0, children: [] },
          }
        }
        case 'stack': {
          const list = D.events.get(Number(a.lane)) ?? []
          const at = Number(a.time)
          const chain = list.filter((e) => e.s <= at && e.s + e.ms / 1000 >= at).sort((x, y) => x.d - y.d)
          const sel = Math.min(Number(a.depth ?? chain.length - 1), chain.length - 1)
          const me = chain[sel]
          const ix = lanesIdx(Number(a.lane))
          return {
            ...base(),
            stack: chain.map((e) => ({
              id: e.t,
              name: NAMES[e.t],
              start: e.s,
              ms: r3(e.ms),
              excl: r3(e.x),
              depth: e.d,
            })),
            selected: sel,
            children: me
              ? ix
                  .childrenOf(me)
                  .map((c) => ({ id: c.t, name: NAMES[c.t], count: 1, incl: r3(c.ms), inclMax: r3(c.ms) }))
              : [],
          }
        }
        case 'instances': {
          const hits = []
          for (const [lane, list] of D.events)
            for (const e of list)
              if (e.t === a.timer && inRange(a, e))
                hits.push({ lane, start: e.s, ms: r3(e.ms), excl: r3(e.x), depth: e.d })
          hits.sort((x, y) => y.ms - x.ms)
          const sum = hits.reduce((s, x) => s + x.ms, 0)
          return {
            ...base(),
            id: a.timer,
            name: NAMES[a.timer],
            count: hits.length,
            incl: r3(sum),
            excl: r3(hits.reduce((s, x) => s + x.excl, 0)),
            min: hits.at(-1)?.ms ?? 0,
            max: hits[0]?.ms ?? 0,
            avg: hits.length ? r3(sum / hits.length) : 0,
            median: hits[hits.length >> 1]?.ms ?? 0,
            items: hits.slice(0, 50),
          }
        }
        // ---------- UELink 2.11 起（globalThis.__fakeTraceOld 为真时装成旧桥接，测面板的兜底） ----------
        case 'framestats':
        case 'framediff':
        case 'session':
        case 'tasks':
          if (globalThis.__fakeTraceOld) throw new Error(`不认识的查询：${a.what}`)
          return v211(a, D)
        default:
          throw new Error(`不认识的查询：${a.what}`)
      }
    },
  }
}
