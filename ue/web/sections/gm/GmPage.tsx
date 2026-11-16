import { RefreshCw, SlidersHorizontal, Wand2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { LuaGmBinding, LuaGmConfig, LuaGmScan } from '../../../server/lua-gm/types.ts'
import type { GmMacro } from '../../../server/types.ts'
import { ppost } from '../../api.ts'
import { useAsk } from '../../ask.tsx'
import { useToChat } from '../../chat.tsx'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useKept } from '../../keep.ts'
import { takePending } from '../../pending.ts'
import { PANE_FILL, PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '../../split.tsx'
import { ErrorText, PageHead } from '../../ui.tsx'
import { favOf, groupKey, parseFav, search, type GmEntry, type GmParam } from './data.ts'
import { GmDetail } from './GmDetail.tsx'
import { GmList, type GmRow } from './GmList.tsx'
import { GmNav, sameView, type GmView } from './GmNav.tsx'
import { BindDialog, LuaSetup } from './LuaSetup.tsx'
import { MacroPane } from './MacroPane.tsx'
import { runEntry, type RunOut } from './run.ts'
import { useGm } from './use-gm.ts'

/**
 * GM 页（用户 2026-11-16：Lua GM 并进来，原来的页不合理要重做；效果图 designs/GM页重设计-效果图）。
 * 左栏 收藏 / 最近 / 来源 / 分组 / 宏，中间紧凑列表，右边选中 GM 的详情或正在编辑的宏。
 * Lua GM 不需要 UE 在运行就能列出来（扫描只读本机文件），执行才要
 */
export function GmPage() {
  const { project, target } = useUe()
  const { toast, ui } = h()
  const [nonce, setNonce] = useState(0)
  const d = useGm(nonce)
  const chat = useToChat()
  const [view, setView] = useKept<GmView>(`gm-view/${project.id}`, { kind: 'all' })
  const [q, setQ] = useState(() => takePending('gm') ?? '')
  const [sel, setSel] = useKept<string>(`gm-sel/${project.id}`, '')
  const [args, setArgs] = useKept<Record<string, string[]>>(`gm-args/${project.id}`, {})
  const [outs, setOuts] = useState<Record<string, RunOut>>({})
  const [running, setRunning] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [setup, setSetup] = useState(false)
  const [bind, setBind] = useState<{ entry: GmEntry; p: GmParam; current?: LuaGmBinding }>()
  const [dialog, ask] = useAsk()
  const nav = usePane('gm-nav', '216px', 180)
  const list = usePane('gm-list', '360px', 260)
  const navRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLElement>(null)

  const all = d.entries
  const byKey = useMemo(() => new Map(all.map((e) => [e.key, e])), [all])
  const find = (k: string) => byKey.get(k) ?? all.find((e) => e.src !== 'lua' && `cpp:${e.name}` === k)
  const favs = d.gm.favGm.map(parseFav)
  const favKeys = new Set(
    favs.map((f) => (f.lua ? `lua:${f.name}` : all.find((e) => e.src !== 'lua' && e.name === f.name)?.key ?? '')),
  )
  const project_ = all.filter((e) => e.src !== 'engine')
  const counts = {
    fav: favs.length,
    recent: d.recent.length,
    all: project_.length,
    lua: all.filter((e) => e.src === 'lua').length,
    cpp: all.filter((e) => e.src === 'cpp').length,
    engine: all.filter((e) => e.src === 'engine').length,
  }
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; label: string; n: number }>()
    for (const e of project_) {
      const id = groupKey(e.group)
      if (!id) continue
      const g = m.get(id) ?? { id, label: e.group, n: 0 }
      g.n++
      m.set(id, g)
    }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label))
    // project_ 跟着 all 变
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [all])

  const macro = view.kind === 'macro' ? d.gm.macros.find((m) => m.id === view.id) : undefined
  // 中间列表的行：编辑宏时列全部（好往宏里加），其余按左栏选的
  const rows: GmRow[] = useMemo(() => {
    const plain = (es: GmEntry[]) => search(es, q).map((e) => ({ id: e.key, entry: e }))
    if (view.kind === 'fav')
      return favs.flatMap((f, i) => {
        const e = f.lua ? byKey.get(`lua:${f.name}`) : all.find((x) => x.src !== 'lua' && x.name === f.name)
        return e && search([e], q).length ? [{ id: `fav${i}`, entry: e, args: f.args }] : []
      })
    if (view.kind === 'recent')
      return d.recent.flatMap((r, i) => {
        const e = find(r.key)
        return e && search([e], q).length
          ? [{ id: `run${i}`, entry: e, args: r.args, note: new Date(r.at).toLocaleTimeString(), bad: !r.ok }]
          : []
      })
    if (view.kind === 'lua' || view.kind === 'cpp' || view.kind === 'engine')
      return plain(all.filter((e) => e.src === view.kind))
    if (view.kind === 'group') return plain(project_.filter((e) => groupKey(e.group) === view.id))
    return plain(project_)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [all, view, q, d.gm, d.recent])
  const row = rows.find((r) => r.id === sel) ?? (sel ? rows.find((r) => r.entry.key === sel) : undefined)
  const entry = row?.entry ?? (sel ? byKey.get(sel) : undefined)
  const cur = entry ? (args[entry.key] ?? entry.params.map(() => '')) : []

  const setArg = (i: number, v: string) =>
    entry && setArgs({ ...args, [entry.key]: entry.params.map((_, k) => (k === i ? v : (cur[k] ?? ''))) })
  const fill = (a: string[]) => entry && setArgs({ ...args, [entry.key]: entry.params.map((_, k) => a[k] ?? '') })

  const canRun = !d.inst ? t('UE 没在运行：GM 要在运行中的编辑器或游戏里执行') : ''
  const exec = async () => {
    if (!entry) return
    setRunning(true)
    const r = await runEntry(project.id, entry, cur, target)
    setRunning(false)
    setOuts({ ...outs, [entry.key]: r })
    d.pushRecent({
      key: entry.key,
      name: entry.name,
      args: cur,
      code: r.code,
      ok: r.ok,
      out: (r.ok ? r.lines.find(Boolean) : r.error) ?? '',
      at: new Date().toISOString(),
    })
  }
  const toggleFav = () => {
    if (!entry) return
    const k = favOf(entry, cur)
    const has = d.gm.favGm.includes(k)
    void d.saveGm({ ...d.gm, favGm: has ? d.gm.favGm.filter((f) => f !== k) : [...d.gm.favGm, k] })
  }
  const stepOf = (e: GmEntry, a: string[]) => (e.src === 'lua' ? { lua: e.name, args: a } : { gm: e.name, args: a })
  const saveMacro = (m: GmMacro) => d.saveGm({ ...d.gm, macros: d.gm.macros.map((x) => (x.id === m.id ? m : x)) })
  const newMacro = async (first?: GmMacro['steps'][number]) => {
    const name = await ask({ title: t('新建宏'), label: t('宏的名字'), init: '' })
    if (!name?.trim()) return
    const m: GmMacro = { id: `m${Date.now().toString(36)}`, name: name.trim(), steps: first ? [first] : [] }
    await d.saveGm({ ...d.gm, macros: [...d.gm.macros, m] })
    setView({ kind: 'macro', id: m.id })
  }
  // 「加到宏」：有宏时选一个（或新建），选完切到那个宏
  const addToMacro = async () => {
    if (!entry) return
    const step = stepOf(entry, cur)
    if (!d.gm.macros.length) return void newMacro(step)
    const names = d.gm.macros.map((m) => m.name)
    const pick = await ask({
      title: t('加到哪个宏'),
      label: t('宏的名字（写一个新名字就新建）：{names}', { names: names.join('、') }),
      init: names[0],
    })
    if (!pick?.trim()) return
    const m = d.gm.macros.find((x) => x.name === pick.trim())
    if (!m) {
      const nm: GmMacro = { id: `m${Date.now().toString(36)}`, name: pick.trim(), steps: [step] }
      await d.saveGm({ ...d.gm, macros: [...d.gm.macros, nm] })
    } else await saveMacro({ ...m, steps: [...m.steps, step] })
    toast.success(t('已加到宏「{name}」', { name: pick.trim() }))
  }

  const rescan = async () => {
    setScanning(true)
    try {
      d.lua.setData(await ppost<{ scan: LuaGmScan; config: LuaGmConfig }>(project.id, 'lua-gm/scan'))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setScanning(false)
    }
  }
  const askAi = chat.available
    ? async (mode: 'create' | 'fix', note = '') => {
        try {
          const r = await ppost<{ text: string }>(project.id, 'lua-gm/prompt', { mode, note })
          chat.send(r.text)
        } catch (e) {
          toast.error((e as Error).message)
        }
      }
    : undefined
  const fixScript = async () => {
    if (!askAi) return
    const note = await ask({
      title: t('让 AI 改扫描脚本'),
      label: t('哪里扫得不对（例如：漏了 GMRole.lua 里的 GM、参数类型不对），可以不写'),
      init: '',
      allowEmpty: true,
    })
    if (note !== undefined) void askAi('fix', note)
  }

  const listTitle = (() => {
    const n = rows.length
    switch (view.kind) {
      case 'fav':
        return t('收藏 · {n} 条（点一行连参数一起填好）', { n })
      case 'recent':
        return t('最近执行 · {n} 条', { n })
      case 'macro':
        return t('编辑宏时点 ＋ 把 GM 加进去 · {n} 条', { n })
      case 'engine':
        return t('引擎自带 · {n} 条', { n })
      case 'group':
        return t('{g} · {n} 条', { g: view.label, n })
      case 'lua':
        return t('Lua · {n} 条', { n })
      case 'cpp':
        return t('C++（项目）· {n} 条', { n })
      default:
        return t('全部 · {n} 条（不含引擎自带）', { n })
    }
  })()
  const emptyText = !d.inst && view.kind !== 'lua' && !counts.lua
    ? t('UE 没在运行：C++ GM 要连上运行中的编辑器或游戏才列得出。Lua GM 设置好扫描脚本后不用开 UE 也能看')
    : view.kind === 'fav'
      ? t('还没有收藏：选一条 GM，填好参数点「收藏这组参数」')
      : view.kind === 'recent'
        ? t('还没有执行过')
        : q
          ? t('没有名字、说明或参数里含「{q}」的 GM', { q })
          : t('这里没有 GM')

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      {dialog}
      {chat.dialog}
      <PageHead
        title="GM"
        desc={t('项目的 C++ GM 和 Lua GM 放在一起；Lua GM 由扫描脚本从 GM 文件里列出，文件变了自动重扫')}
      >
        <ui.Button size="sm" variant="secondary" onClick={() => setNonce((n) => n + 1)}>
          <RefreshCw className="ue:h-3.5 ue:w-3.5" /> {t('刷新')}
        </ui.Button>
        <ui.Button size="sm" variant="ghost" onClick={() => setSetup(true)}>
          <SlidersHorizontal className="ue:h-3.5 ue:w-3.5" /> {t('Lua GM 扫描设置')}
        </ui.Button>
      </PageHead>
      <ErrorText>{d.cpp.error || d.lua.error}</ErrorText>
      <div className={SPLIT_ROW}>
        <nav ref={navRef} style={nav.style('30%')} className={`ue:flex ue:flex-col ${PANE_FIXED}`}>
          <GmNav
            view={view}
            onView={(v) => {
              setView(v)
              if (!sameView(v, view) && v.kind !== 'macro') setSel('')
            }}
            counts={counts}
            groups={groups}
            macros={d.gm.macros}
            onNewMacro={() => void newMacro()}
            scan={d.lua.data?.scan}
            scanning={scanning}
            onRescan={() => void rescan()}
            onFixScript={() => void fixScript()}
            onSetup={() => setSetup(true)}
          />
        </nav>
        <SplitHandle pane={nav} paneRef={navRef} reserve={() => 700} />
        <section ref={listRef} style={list.style('45%')} className={`ue:flex ue:flex-col ${PANE_FIXED}`}>
          <GmList
            rows={rows}
            grouped={view.kind !== 'group' && view.kind !== 'fav' && view.kind !== 'recent'}
            sel={macro ? undefined : (row?.id ?? sel)}
            onSel={(r) => {
              setSel(r.id)
              if (r.args) setArgs({ ...args, [r.entry.key]: r.entry.params.map((_, k) => r.args?.[k] ?? '') })
              if (macro) setView({ kind: 'all' })
            }}
            favs={favKeys}
            q={q}
            onQ={setQ}
            title={listTitle}
            empty={emptyText}
            onAdd={
              macro
                ? (r) => void saveMacro({ ...macro, steps: [...macro.steps, stepOf(r.entry, r.args ?? args[r.entry.key] ?? [])] })
                : undefined
            }
          />
        </section>
        <SplitHandle pane={list} paneRef={listRef} reserve={() => 420} />
        <section className={`ue:flex ue:min-h-0 ue:flex-col ${PANE_FILL}`}>
          {macro ? (
            <MacroPane
              macro={macro}
              find={find}
              onSave={saveMacro}
              onDelete={() =>
                void d.saveGm({ ...d.gm, macros: d.gm.macros.filter((x) => x.id !== macro.id) }).then(() => setView({ kind: 'all' }))
              }
              canRun={canRun}
              toChat={chat.available ? chat.send : undefined}
            />
          ) : entry ? (
            <GmDetail
              entry={entry}
              args={cur}
              onArg={setArg}
              onArgs={fill}
              config={d.lua.data?.config}
              gm={d.gm}
              onGm={d.saveGm}
              onRun={() => void exec()}
              running={running}
              out={outs[entry.key]}
              canRun={canRun}
              history={d.recent.filter((r) => r.key === entry.key)}
              fav={d.gm.favGm.includes(favOf(entry, cur))}
              onFav={toggleFav}
              onMacro={() => void addToMacro()}
              toChat={chat.available ? chat.send : undefined}
              onEditBinding={(p, current) => setBind({ entry, p, current })}
            />
          ) : (
            <div className="ue:flex ue:flex-1 ue:flex-col ue:items-center ue:justify-center ue:gap-2 ue:p-8 ue:text-center ue:text-footnote ue:text-subtle">
              <Wand2 className="ue:h-6 ue:w-6" />
              {t('选一条 GM，在这里填参数、执行')}
            </div>
          )}
        </section>
      </div>
      {setup && d.lua.data && (
        <LuaSetup
          config={d.lua.data.config}
          scan={d.lua.data.scan}
          onClose={() => setSetup(false)}
          onSaved={(r) => d.lua.setData(r)}
          askAi={askAi ? (mode) => void askAi(mode) : undefined}
        />
      )}
      {bind && (
        <BindDialog
          param={bind.p.name}
          current={bind.current}
          hint={bind.p.table}
          onClose={() => setBind(undefined)}
          onSave={async (b) => {
            try {
              const r = await ppost<{ config: LuaGmConfig; scan: LuaGmScan }>(project.id, 'lua-gm/config', {
                binding: { key: `${bind.entry.name}.${bind.p.name}`, value: b },
              })
              d.lua.setData(r)
              setBind(undefined)
            } catch (e) {
              toast.error((e as Error).message)
            }
          }}
        />
      )}
    </div>
  )
}
