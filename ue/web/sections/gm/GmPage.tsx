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
import { favOf, parseFav, type GmEntry, type GmParam } from './data.ts'
import { GmDetail } from './GmDetail.tsx'
import { LuaStatus } from './LuaStatus.tsx'
import { GmTree, type GmPick, type GmSrcFilter } from './GmTree.tsx'
import { LuaSetup } from './LuaSetup.tsx'
import { MacroPane } from './MacroPane.tsx'
import { runEntry, type RunOut } from './run.ts'
import { TableBindDialog } from './TableBindDialog.tsx'
import { listTables, searchRows, tableShape } from './tables.ts'
import { useGm } from './use-gm.ts'

/**
 * GM 页（用户 2026-11-16：Lua GM 并进来，原来的页不合理要重做）。分组上百个、Lua GM 上千条后改成两栏：
 * 左边一棵树（收藏、最近执行、宏，加按「 / 」分层的分组文件夹，GM 挂在里面），右边选中 GM 的详情或正在编辑的宏。
 * Lua GM 不需要 UE 在运行就能列出来（扫描只读本机文件），执行才要
 */
export function GmPage() {
  const { project, target } = useUe()
  const { toast, ui } = h()
  const [nonce, setNonce] = useState(0)
  const d = useGm(nonce)
  const chat = useToChat()
  const [src, setSrc] = useKept<GmSrcFilter>(`gm-src/${project.id}`, 'all')
  const [q, setQ] = useState(() => takePending('gm') ?? '')
  const [pick, setPick] = useKept<GmPick | undefined>(`gm-pick/${project.id}`, undefined)
  const [args, setArgs] = useKept<Record<string, string[]>>(`gm-args/${project.id}`, {})
  const [outs, setOuts] = useState<Record<string, RunOut>>({})
  const [running, setRunning] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [setup, setSetup] = useState(false)
  const [bind, setBind] = useState<{ entry: GmEntry; p: GmParam; current?: LuaGmBinding }>()
  const [dialog, ask] = useAsk()
  const nav = usePane('gm-tree', '380px', 260)
  const navRef = useRef<HTMLElement>(null)

  const all = d.entries
  const byKey = useMemo(() => new Map(all.map((e) => [e.key, e])), [all])
  const find = (k: string) => byKey.get(k) ?? all.find((e) => e.src !== 'lua' && `cpp:${e.name}` === k)
  const project_ = all.filter((e) => e.src !== 'engine')
  const counts: Record<GmSrcFilter, number> = {
    all: project_.length,
    lua: all.filter((e) => e.src === 'lua').length,
    cpp: all.filter((e) => e.src === 'cpp').length,
    engine: all.filter((e) => e.src === 'engine').length,
  }
  const shown = useMemo(
    () => (src === 'all' ? all.filter((e) => e.src !== 'engine') : all.filter((e) => e.src === src)),
    [all, src],
  )
  const favs = useMemo(
    () =>
      d.gm.favGm.map(parseFav).flatMap((f) => {
        const e = f.lua ? byKey.get(`lua:${f.name}`) : all.find((x) => x.src !== 'lua' && x.name === f.name)
        return e ? [{ entry: e, args: f.args }] : []
      }),
    [d.gm.favGm, all, byKey],
  )
  const recent = useMemo(
    () => d.recent.flatMap((r) => (find(r.key) ? [{ entry: find(r.key)!, args: r.args, ok: r.ok, at: r.at }] : [])),
    // find 跟着 all 变
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [d.recent, all],
  )
  const macro = pick?.kind === 'macro' ? d.gm.macros.find((m) => m.id === pick.id) : undefined
  const entry = pick?.kind === 'gm' ? byKey.get(pick.key) : undefined
  const cur = entry ? (args[entry.key] ?? entry.params.map(() => '')) : []
  const choose = (p: GmPick) => {
    setPick(p)
    // 从收藏、最近执行点进来：连那组参数一起填好
    if (p.kind === 'gm' && p.args) {
      const e = byKey.get(p.key)
      if (e) setArgs({ ...args, [e.key]: e.params.map((_, k) => p.args?.[k] ?? '') })
    }
  }

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
    setPick({ kind: 'macro', id: m.id })
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
        <nav ref={navRef} style={nav.style('40%')} className={`ue:flex ue:flex-col ${PANE_FIXED}`}>
          <GmTree
            entries={shown}
            favs={favs}
            recent={recent}
            macros={d.gm.macros}
            src={src}
            onSrc={setSrc}
            counts={counts}
            q={q}
            onQ={setQ}
            selected={pick?.kind === 'macro' ? `macro:${pick.id}` : (pick?.line ?? '')}
            onPick={choose}
            onNewMacro={() => void newMacro()}
            onAdd={
              macro
                ? (e, a) => void saveMacro({ ...macro, steps: [...macro.steps, stepOf(e, a ?? args[e.key] ?? [])] })
                : undefined
            }
            footer={
              <LuaStatus
                scan={d.lua.data?.scan}
                scanning={scanning}
                onRescan={() => void rescan()}
                onFixScript={() => void fixScript()}
                onSetup={() => setSetup(true)}
              />
            }
          />
          {!d.inst && !counts.lua && (
            <p className="ue:border-t ue:border-line ue:p-3 ue:text-caption ue:text-subtle">
              {t('UE 没在运行：C++ GM 要连上运行中的编辑器或游戏才列得出。Lua GM 设置好扫描脚本后不用开 UE 也能看')}
            </p>
          )}
        </nav>
        <SplitHandle pane={nav} paneRef={navRef} reserve={() => 480} />
        <section className={`ue:flex ue:min-h-0 ue:flex-col ${PANE_FILL}`}>
          {macro ? (
            <MacroPane
              macro={macro}
              find={find}
              onSave={saveMacro}
              onDelete={() =>
                void d
                  .saveGm({ ...d.gm, macros: d.gm.macros.filter((x) => x.id !== macro.id) })
                  .then(() => setPick(undefined))
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
              {t('在左边的树里选一条 GM，在这里填参数、执行')}
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
        <TableBindDialog
          param={bind.p.name}
          current={bind.current}
          hint={bind.entry.src === 'lua' ? bind.p.table : undefined}
          load={{
            tables: (q) => listTables(project.id, q),
            shape: (table, sheet) => tableShape(project.id, table, sheet),
            rows: (b, q) => searchRows(project.id, b, q),
          }}
          onClose={() => setBind(undefined)}
          onSave={async (b) => {
            const key = `${bind.entry.name}.${bind.p.name}`
            try {
              if (bind.entry.src === 'lua') {
                const r = await ppost<{ config: LuaGmConfig; scan: LuaGmScan }>(project.id, 'lua-gm/config', {
                  binding: { key, value: b },
                })
                d.lua.setData(r)
              } else {
                // C++ GM 的关联存 gm.json（团队共用）；改成关联表格后旧的 DataTable 绑定一起去掉
                const tableBindings = { ...d.gm.tableBindings }
                const bindings = { ...d.gm.bindings }
                delete bindings[key]
                if (b) tableBindings[key] = b
                else delete tableBindings[key]
                await d.saveGm({ ...d.gm, tableBindings, bindings })
              }
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
