import { RefreshCw, SlidersHorizontal } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { LuaGmBinding, LuaGmConfig, LuaGmScan } from '../../../server/lua-gm/types.ts'
import type { GmCat, GmCustom, GmCustomObj, GmMacro } from '../../../shared/gm/schema.ts'
import type { GtRef } from '../../../shared/gt-script/ref/types.ts'
import { ppost } from '../../api.ts'
import { useAsk } from '../../ask.tsx'
import { useToChat } from '../../chat.tsx'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useKept } from '../../keep.ts'
import { takePending } from '../../pending.ts'
import { DockCol } from '../../nav/slot.tsx'
import {
  PANE_FILL,
  PANE_FILL_H,
  PANE_FIXED,
  PANE_FIXED_H,
  SPLIT_ROW,
  SplitHandle,
  usePane,
  usePaneHeight,
} from '../../split.tsx'
import { ErrorText, PageHead } from '../../ui.tsx'
import type { GmEntry, GmParam } from './data.ts'
import { GmMain } from './GmMain.tsx'
import { LuaSetup } from './LuaSetup.tsx'
import { LuaStatus } from './LuaStatus.tsx'
import { GmNav, type GmPick, type SrcFilter } from './nav/GmNav.tsx'
import { useLocalPref } from './nav/local.ts'
import { useGmMenus } from './nav/use-gm-menus.ts'
import { useObjCallState } from './objcall/use-objcall-state.tsx'
import { useGameTest } from './objcall/use-objcall.ts'
import { RecentRuns, type RecentRun } from './RecentRuns.tsx'
import { TableBindDialog } from './TableBindDialog.tsx'
import { listTables, searchRows, storedTable, tableShape } from './tables.ts'
import { useGm } from './use-gm.ts'
import { useGmRun } from './use-gm-run.ts'

/**
 * GM 页（规格第 6、7 节，效果图 designs/GM页重设计-对象调用-效果图）。左栏顶上分类 GM · 引擎 · 宏 · 对象调用：
 * GM 按模块分（扫描出来的默认归分组第一段，没分组的进「未归模块」；自定义 GM 在模块下的「自定义」文件夹），
 * 引擎是引擎自带 GM 和控制台命令，对象调用是对象列表；收藏在左栏最下面、每个分类一份。
 * 右边上面是选中的详情 / 宏 / 对象调用工作台，下面是最近执行（用户 2026-11-21），上下分界能拖、记在本机。
 * Lua GM 不需要 UE 在运行就能列出来（扫描只读本机文件），执行才要；gm.json 由服务端推 gm 事件刷新
 */
export function GmPage() {
  const { project } = useUe()
  const { toast, ui } = h()
  const [nonce, setNonce] = useState(0)
  const d = useGm(nonce)
  const chat = useToChat()
  const gt = useGameTest()
  const s = useObjCallState(d, gt.live)
  const run = useGmRun(d)
  const [cat, setCat] = useLocalPref<GmCat>('cat', 'gm')
  const [srcBy, setSrcBy] = useLocalPref<Partial<Record<GmCat, SrcFilter>>>(`src/${project.id}`, {})
  // 从双击 Shift 跳过来带着搜索词：落在 GM 分类
  const [qBy, setQBy] = useState<Partial<Record<GmCat, string>>>(() => ({ gm: takePending('gm') ?? '' }))
  // 右边选中的按分类记（规格第 6 节）：切到哪个分类就显示它上次选的，没选过就是空的，不留别的分类的详情
  const [picks, setPicks] = useKept<Partial<Record<GmCat, GmPick>>>(`gm-picks/${project.id}`, {})
  const pick = cat === 'objcall' ? undefined : picks[cat]
  const setPickIn = (c: GmCat, p: GmPick | undefined) => setPicks((m) => ({ ...m, [c]: p }))
  const setPick = (p: GmPick | undefined) => setPickIn(cat, p)
  const [scanning, setScanning] = useState(false)
  const [setup, setSetup] = useState(false)
  const [bind, setBind] = useState<{ entry: GmEntry; p: GmParam; current?: LuaGmBinding }>()
  const [dialog, ask] = useAsk()
  const menus = useGmMenus(d, ask, (id) => {
    const m = picks.macro
    if (m?.kind === 'macro' && m.id === id) setPickIn('macro', undefined)
  })
  const nav = usePane('gm-tree', '380px', 260)
  const navRef = useRef<HTMLElement>(null)
  const recentPane = usePaneHeight('gm-recent', '14rem', 96)
  const recentRef = useRef<HTMLDivElement>(null)

  const all = d.entries
  const byKey = useMemo(() => new Map(all.map((e) => [e.key, e])), [all])
  const find = (k: string) => byKey.get(k)
  const recent = useMemo<RecentRun[]>(
    () => d.recent.flatMap((r) => (byKey.has(r.key) ? [{ entry: byKey.get(r.key)!, run: r }] : [])),
    [d.recent, byKey],
  )
  const entry = pick?.kind === 'gm' ? byKey.get(pick.key) : undefined
  const choose = (p: GmPick, c: GmCat = cat) => {
    setPickIn(c, p)
    // 从收藏、最近执行点进来：连那组参数一起填好
    const e = p.kind === 'gm' ? byKey.get(p.key) : undefined
    if (e && p.kind === 'gm' && p.args) run.fill(e, p.args)
  }
  const canRun = !d.inst ? t('UE 没在运行：GM 要在运行中的编辑器或游戏里执行') : ''

  const newMacro = async (first?: GmMacro['steps'][number]) => {
    const name = await ask({ title: t('新建宏'), label: t('宏的名字'), init: '' })
    if (!name?.trim()) return
    const m: GmMacro = { id: `m${Date.now().toString(36)}`, name: name.trim(), steps: first ? [first] : [] }
    await d.saveGm({ ...d.gm, macros: [...d.gm.macros, m] })
    setCat('macro')
    setPickIn('macro', { kind: 'macro', id: m.id })
  }
  // 「加到宏」：有宏时选一个（或写个新名字新建）
  const addToMacro = async (e: GmEntry) => {
    const step = run.stepOf(e)
    if (!d.gm.macros.length) return void newMacro(step)
    const names = d.gm.macros.map((m) => m.name)
    const name = (
      await ask({
        title: t('加到哪个宏'),
        label: t('宏的名字（写一个新名字就新建）：{names}', { names: names.join('、') }),
        init: names[0],
      })
    )?.trim()
    if (!name) return
    const m = d.gm.macros.find((x) => x.name === name)
    const macros = m
      ? d.gm.macros.map((x) => (x.id === m.id ? { ...m, steps: [...m.steps, step] } : x))
      : [...d.gm.macros, { id: `m${Date.now().toString(36)}`, name, steps: [step] }]
    await d.saveGm({ ...d.gm, macros })
    toast.success(t('已加到宏「{name}」', { name }))
  }
  /** 自定义 GM 的「改匹配规则」：改的是这条 GM 自己的对象副本（对象列表里的不动） */
  const editRule = (c: GmCustom) => {
    const o = c.objects[c.obj]
    if (!o?.ref) return
    s.editRef(o.ref as GtRef, (ref) => {
      const objects = { ...c.objects, [c.obj]: { ref: ref as GmCustomObj['ref'] } as GmCustomObj }
      void d.saveGm({ ...d.gm, custom: d.gm.custom.map((x) => (x.id === c.id ? { ...x, objects } : x)) })
    })
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

  const tree = () => (
    <>
      <GmNav
        d={d}
        cat={cat}
        onCat={setCat}
        q={qBy[cat] ?? ''}
        onQ={(q) => setQBy({ ...qBy, [cat]: q })}
        src={srcBy[cat] ?? 'all'}
        onSrc={(x) => setSrcBy({ ...srcBy, [cat]: x })}
        pick={pick}
        onPick={choose}
        onNewMacro={() => void newMacro()}
        onNewModule={() => void menus.newModule()}
        onGmMenu={menus.onGmMenu}
        onModuleMenu={menus.onModuleMenu}
        onMacroMenu={menus.onMacroMenu}
        objList={gt.known && !gt.installed ? undefined : s.listProps}
        footer={
          cat === 'gm' ? (
            <LuaStatus
              scan={d.lua.data?.scan}
              scanning={scanning}
              onRescan={() => void rescan()}
              onFixScript={() => void fixScript()}
              onSetup={() => setSetup(true)}
            />
          ) : undefined
        }
      />
      {cat === 'gm' && !d.inst && !d.lua.data?.scan.items.length && (
        <p className="ue:border-t ue:border-line ue:p-3 ue:text-caption ue:text-subtle">
          {t('UE 没在运行：C++ GM 要连上运行中的编辑器或游戏才列得出。Lua GM 设置好扫描脚本后不用开 UE 也能看')}
        </p>
      )}
    </>
  )

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      {dialog}
      {chat.dialog}
      {s.dialogs}
      <PageHead
        title="GM"
        desc={t('项目的 GM 按模块放；对象调用能直接调游戏里对象的函数，常用的存成 GM。都存在 {file}（团队共用）', {
          file: d.file ?? 'gm.json',
        })}
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
        {/* GM 树整栏放进左边二级面板（用户 2026-11-18 定）；面板太旧或二级面板收起时照旧是页里左边一栏 */}
        <DockCol
          body={tree}
          fallback={
            <>
              <nav ref={navRef} style={nav.style('40%')} className={`ue:flex ue:flex-col ${PANE_FIXED}`}>
                {tree()}
              </nav>
              <SplitHandle pane={nav} paneRef={navRef} reserve={() => 480} />
            </>
          }
        />
        <section className={`ue:flex ue:min-h-0 ue:flex-col ue:divide-y ue:divide-line ue:lg:divide-y-0 ${PANE_FILL}`}>
          <div className={`ue:flex ue:min-h-80 ue:flex-col ue:lg:min-h-0 ${PANE_FILL_H}`}>
            <GmMain
              d={d}
              cat={cat}
              pick={pick}
              entry={entry}
              find={find}
              run={run}
              obj={s}
              gt={gt}
              canRun={canRun}
              toChat={chat.available ? chat.send : undefined}
              onEditBinding={(e, prm, current) => setBind({ entry: e, p: prm, current })}
              onMacro={(e) => void addToMacro(e)}
              onOpenObjCall={(c) => {
                setCat('objcall')
                void s.openCustom(c)
              }}
              onEditRule={editRule}
              onPickNone={() => setPick(undefined)}
            />
          </div>
          <SplitHandle pane={recentPane} paneRef={recentRef} side="right" reserve={() => 200} />
          <div
            ref={recentRef}
            className={`ue:flex ue:flex-col ${PANE_FIXED_H}`}
            style={recentPane.style('calc(100% - 200px)')}
          >
            <RecentRuns
              items={recent.slice(0, 60)}
              selected=""
              onPick={(_line, r) => {
                // 点最近执行：切到它所在的分类再选中
                const c: GmCat = r.entry.src === 'engine' || r.entry.src === 'console' ? 'engine' : 'gm'
                setCat(c)
                choose({ kind: 'gm', key: r.entry.key, args: r.run.args }, c)
              }}
            />
          </div>
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
          onSave={async (raw) => {
            // 表格路径存相对版本库根的（shared/gm/table-path.ts）；旧的绝对路径在这里换成相对的
            const b = raw && { ...raw, table: storedTable(project.id, raw.table) }
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
