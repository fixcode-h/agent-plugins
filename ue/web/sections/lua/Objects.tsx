import { Ghost, Recycle } from 'lucide-react'
import { useRef, useState } from 'react'
import { parseLuaPath, type LuaKey } from '../../../server/luapath.ts'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useKept } from '../../keep.ts'
import { LuaTable } from '../../Lua.tsx'
import { PANE_FILL, PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '@panel/web/src/components/ui/split-pane'
import { Card, ErrorText } from '../../ui.tsx'
import { SearchBox } from '@panel/web/src/components/ui/search-box'
import type { LeakResult } from './debug-types.ts'
import { rootKey, type LuaRoot } from './inspect-data.ts'
import { LuaInspector } from './Inspector.tsx'
import { useLuaOp } from './lua-data.ts'
import { GroupView } from './objects-tree/GroupView.tsx'
import { LeakView } from './objects-tree/LeakView.tsx'
import { ObjectsTree } from './objects-tree/ObjectsTree.tsx'
import { useTreeData, type LuaSel } from './objects-tree/tree-data.ts'
import { WatchList } from './objects-tree/WatchList.tsx'

/**
 * Lua 页「对象」页签（设计稿 designs/Lua对象页重设计-设计稿.md）：左栏一棵树（全局、绑定对象、模块分组，绑定对象可按
 * Lua 类 / UE 类 / 归属成树，搜索认类名含子类），右边按选中的东西换：检视区（字段、按继承层分组的函数、upvalue）、
 * 一个类的全部对象、一个 Lua 还拿着的已销毁对象。上面一行是 Lua 内存和「跑一次 Lua GC」「查已销毁对象」。
 * 进程的 UELink 早于 2.4（没有 lua.inspect）时退回原来的「按路径看全局表」
 */
export function LuaObjects() {
  const ok = useLuaOp('lua.inspect')
  return ok ? <Inspect /> : <LegacyGlobals />
}

function Inspect() {
  const { project, go, target } = useUe()
  const { ui } = h()
  const kk = `${project.id}/lua`
  const [sel, setSel] = useKept<LuaSel>(`${kk}/sel`, { kind: 'root', root: { path: '', keys: [] } })
  const [watch, setWatch] = useKept<LuaRoot[]>(`${kk}/watch`, [])
  const [leaks, setLeaks] = useKept<LeakResult | undefined>(`${kk}/leaks`, undefined)
  // 改字段、调函数、跑 GC 之后加一，树、检视区和监视都重读
  const [tick, setTick] = useState(0)
  const bump = () => setTick((n) => n + 1)
  const tree = useTreeData(tick)
  const { busy, run } = useAction()
  const canGc = useLuaOp('lua.gc')
  const canLeaks = useLuaOp('lua.leaks')
  const pane = usePane('lua-objects', '340px', 240)
  const left = useRef<HTMLDivElement>(null)
  const openObj = (p: string) => go(p.startsWith('/Game') && !p.includes(':') ? 'assets' : 'objects', p)
  const pick = (r: LuaRoot) => setSel({ kind: 'root', root: r })
  const root = sel.kind === 'root' ? sel.root : undefined
  const objs = tree.data?.objs ?? []

  const scanLeaks = () =>
    run('leaks', async () => {
      try {
        setLeaks(await op<LeakResult>(project.id, 'lua.leaks', { limit: 200 }, target, 60000))
      } catch (e) {
        h().toast.error((e as Error).message)
      }
    })
  const gc = (thenScan: boolean) =>
    run('gc', async () => {
      try {
        const r = await op<{ beforeKB: number; afterKB: number; ms?: number }>(
          project.id,
          'lua.gc',
          { action: 'collect' },
          target,
        )
        h().toast.success(t('Lua 内存 {a} → {b}', { a: fmtKB(r.beforeKB), b: fmtKB(r.afterKB) }))
        bump()
        if (thenScan) await scanLeaks()
      } catch (e) {
        h().toast.error((e as Error).message)
      }
    })
  const meta = tree.data?.meta
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:bg-card">
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-x-3 ue:gap-y-1 ue:border-b ue:border-line ue:bg-panel ue:px-4 ue:py-1.5 ue:text-caption ue:text-muted">
        {meta?.memoryKB !== undefined && (
          <span className="ue:flex ue:items-baseline ue:gap-1">
            {t('Lua 内存')} <b className="ue:font-mono ue:font-medium ue:text-fg">{fmtKB(meta.memoryKB)}</b>
          </span>
        )}
        {tree.data && (
          <span className="ue:flex ue:items-baseline ue:gap-1">
            {t('绑定对象')} <b className="ue:font-mono ue:font-medium ue:text-fg">{objs.length}</b>
            {meta?.more ? '+' : ''}
          </span>
        )}
        {tree.data && (
          <span className="ue:flex ue:items-baseline ue:gap-1">
            {t('已加载模块')} <b className="ue:font-mono ue:font-medium ue:text-fg">{tree.data.modules.length}</b>
          </span>
        )}
        {!!meta?.stale && (
          <span
            className="ue:text-warning"
            title={t('UnLua 的对象表里还记着、但 UObject 已经不在的项：UnLua 销毁对象时没删掉')}
          >
            {t('对象表里的残留 {n}', { n: meta.stale })}
          </span>
        )}
        {tree.data && !tree.data.rich && !!objs.length && (
          <span className="ue:text-subtle">{t('把项目里的 UELink 升到 2.19 以上，能看对象状态、按归属分组')}</span>
        )}
        <span className="ue:ml-auto" />
        {canGc && (
          <ui.Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void gc(false)}>
            <Recycle className="ue:h-3.5 ue:w-3.5" /> {t('跑一次 Lua GC')}
          </ui.Button>
        )}
        {canLeaks && (
          <ui.Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void scanLeaks()}>
            <Ghost className="ue:h-3.5 ue:w-3.5" /> {busy === 'leaks' ? t('查找中…') : t('查 Lua 还拿着的已销毁对象')}
          </ui.Button>
        )}
      </div>
      <div className={SPLIT_ROW}>
        <div ref={left} style={pane.style('50%')} className={`ue:flex ue:min-h-0 ue:flex-col ${PANE_FIXED}`}>
          <ObjectsTree
            data={tree.data}
            error={tree.data?.errors.join('\n') || tree.error}
            sel={sel}
            leaks={leaks?.items}
            onSelect={setSel}
            onReload={bump}
            tick={tick}
            footer={
              <WatchList
                items={watch}
                tick={tick}
                onPick={pick}
                onRemove={(r) => setWatch((w) => w.filter((x) => rootKey(x) !== rootKey(r)))}
              />
            }
          />
        </div>
        <SplitHandle pane={pane} paneRef={left} reserve={() => 480} />
        <div className={`ue:flex ue:min-h-0 ue:flex-col ${PANE_FILL}`}>
          {root ? (
            <LuaInspector
              root={root}
              obj={root.path ? objs.find((o) => o.path === root.path) : undefined}
              objs={objs}
              tick={tick}
              onNav={(keys: LuaKey[]) => pick({ ...root, keys })}
              onPick={pick}
              onOpenObj={openObj}
              onWatch={(r) => setWatch((w) => (w.some((x) => rootKey(x) === rootKey(r)) ? w : [...w, r].slice(-30)))}
              onChanged={bump}
            />
          ) : sel.kind === 'group' ? (
            <GroupView by={sel.by} name={sel.name} objs={objs} onSelect={setSel} />
          ) : sel.kind === 'leak' ? (
            <LeakView item={sel.item} busy={!!busy} onGcAndScan={canGc ? () => void gc(true) : undefined} />
          ) : null}
        </div>
      </div>
    </div>
  )
}

const fmtKB = (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`)

/** 旧 UELink（2.3 及以前）：只能按路径看全局表、改标量 */
function LegacyGlobals() {
  const { go } = useUe()
  const [root, setRoot] = useState<{ keys: LuaKey[]; n: number }>({ keys: [], n: 0 })
  const [pathError, setPathError] = useState('')

  const openPath = (s: string) => {
    try {
      setRoot((r) => ({ keys: parseLuaPath(s), n: r.n + 1 }))
      setPathError('')
    } catch (e) {
      setPathError((e as Error).message)
    }
  }

  return (
    <Card
      className="ue:m-4 ue:flex ue:min-h-0 ue:flex-1 ue:flex-col"
      title={t('全局表')}
      bodyClass="ue:flex ue:min-h-0 ue:flex-col"
    >
      <div className="ue:flex ue:flex-col ue:gap-1 ue:border-b ue:border-line ue:p-3">
        <SearchBox
          placeholder={t('Lua 路径，例如 GameSystemManager 或 package.loaded["Game.Core"]')}
          onSearch={openPath}
          allowEmpty
        />
        <ErrorText>{pathError}</ErrorText>
        <p className="ue:text-caption ue:text-subtle">
          {t('把项目里的 UELink 升到 2.4 以上，这里能看函数、调函数、看元表链和加监视')}
        </p>
      </div>
      <LuaTable
        key={root.n}
        path=""
        initial={root.keys}
        onOpen={(p) => go(p.startsWith('/Game') && !p.includes(':') ? 'assets' : 'objects', p)}
      />
    </Card>
  )
}
