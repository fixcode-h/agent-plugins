import { AppWindow, Box, Boxes, ChevronDown, CodeXml, Component, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GtClassItem, GtClassesResult } from '../../../../../shared/gt-script/index.ts'
import { Checkbox } from '../../../../details/controls.tsx'
import { h, t } from '../../../../host.ts'
import { TreeList, type TreeLine } from '../../../../TreeList.tsx'
import { useRefRpc } from '../live.ts'
import type { ClassKind } from './data.ts'

/** 类的图标：界面、Actor、组件、Lua 各一种，其余对象一种（类树、结构栏、实例栏一致） */
export const KIND_ICON: Record<ClassKind, LucideIcon> = {
  umg: AppWindow,
  actor: Boxes,
  component: Component,
  object: Box,
  lua: CodeXml,
}
export const kindLabel = (k: ClassKind) =>
  ({ umg: 'UMG', actor: 'Actor', component: t('组件'), object: 'UObject', lua: t('Lua 类') })[k]

type Tab = 'class' | 'lua'
const ROOT = 'Object'

/**
 * 顶栏的类下拉（效果图 2）：框里直接打字搜（类名里含这几个字就算），下拉里两个页签「UObject 类树」「Lua 类」，数据来自 gt.classes。
 * 不搜时类树逐层读（点开一层再问下一层），搜时只列命中的和它们的祖先、全部展开。
 * lockClass：类定成它（从函数参数打开时），树从它开始，只能选它和子类
 */
export function ClassPicker({
  project,
  value,
  kind,
  lockClass,
  onPick,
}: {
  project: string
  value: string
  kind?: ClassKind
  lockClass?: string
  onPick: (cls: string, item?: GtClassItem) => void
}) {
  const { cn } = h()
  const rpc = useRefRpc()
  const [open, setOpen] = useState(false)
  const lockLua = !!lockClass?.startsWith('lua:')
  const [tab, setTab] = useState<Tab>(lockLua || value.startsWith('lua:') ? 'lua' : 'class')
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [onlyLive, setOnlyLive] = useState(false)
  const [kids, setKids] = useState<Record<string, GtClassItem[]>>({})
  const [openSet, setOpenSet] = useState<Set<string>>(new Set())
  const [found, setFound] = useState<GtClassesResult>()
  const [error, setError] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const lua = tab === 'lua'
  // 树从哪一层开始：定了类的从它开始；UObject 类树从 Object 开始；Lua 类没有公共的根
  const root = lockClass ? lockClass.replace(/^lua:/, '') : lua ? '' : ROOT

  // 点外面、Esc 关掉
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  // 打字停一会儿再搜
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 250)
    return () => clearTimeout(id)
  }, [text])

  const load = (parent: string) => {
    const key = `${lua ? 'lua' : 'cls'}:${parent}`
    if (kids[key]) return
    rpc<GtClassesResult>(project, 'gt.classes', {
      ...(parent && parent !== ROOT ? { parent } : {}),
      ...(lua ? { lua: true } : {}),
      limit: 500,
    })
      .then((r) => setKids((m) => ({ ...m, [key]: r.items ?? [] })))
      .catch((e: Error) => setError(e.message))
  }

  // 打开下拉、换页签时读第一层
  useEffect(() => {
    if (!open || q) return
    setError('')
    load(root)
    setOpenSet((s) => new Set([...s, root]))
    // load 只依赖 kids（读过就跳过），不放进依赖免得读回来又触发
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, lua, root])

  useEffect(() => {
    if (!open || !q) return setFound(undefined)
    let off = false
    setError('')
    rpc<GtClassesResult>(project, 'gt.classes', { q, ...(lua ? { lua: true } : {}), limit: 200 })
      .then((r) => !off && setFound(r))
      .catch((e: Error) => !off && setError(e.message))
    return () => {
      off = true
    }
  }, [project, open, q, lua, rpc])

  const lines = useMemo(() => {
    const out: TreeLine[] = []
    const lockedIn = new Set<string>()
    const pick = (it: GtClassItem) => {
      onPick(lua ? `lua:${it.name}` : it.name, it)
      setOpen(false)
      setText('')
    }
    const row = (it: GtClassItem, depth: number, expandable: boolean, isOpen: boolean, onToggle?: () => void) => {
      // 名字里含 q 就算命中（用户 2026-11-21：不要只按开头），把命中的那段标出来
      const at = q ? it.name.toLowerCase().indexOf(q.toLowerCase()) : -1
      const engine = !it.asset && it.kind !== 'lua'
      const allowed = !lockClass || lockedIn.has(it.name)
      out.push({
        key: `${depth}:${it.name}`,
        depth,
        icon: KIND_ICON[it.kind] ?? Box,
        iconTone: engine ? undefined : 'ue:text-accent',
        label: (
          <span className={cn('ue:font-mono', (engine || !allowed) && 'ue:opacity-55')}>
            {at >= 0 ? (
              <>
                {it.name.slice(0, at)}
                <b className="ue:text-accent">{it.name.slice(at, at + q.length)}</b>
                {it.name.slice(at + q.length)}
              </>
            ) : (
              it.name
            )}
          </span>
        ),
        aside: [
          it.kind === 'lua' ? 'Lua' : it.asset ? t('蓝图') : t('引擎 / C++'),
          it.live ? t('此刻 {n} 个', { n: it.live }) : '',
        ]
          .filter(Boolean)
          .join(' · '),
        title: it.asset ?? it.file ?? it.name,
        expandable,
        open: isOpen,
        selected: (lua ? `lua:${it.name}` : it.name) === value,
        onToggle,
        onSelect: allowed ? () => pick(it) : undefined,
      })
    }
    const keep = (it: GtClassItem) => !onlyLive || !!it.live || it.kids > 0
    if (q && found) {
      // 搜索：命中的和它们的祖先摊成树，全部展开
      const byParent = new Map<string, GtClassItem[]>()
      const names = new Set(found.items.map((x) => x.name))
      for (const it of found.items) {
        const p = it.parent && names.has(it.parent) ? it.parent : ''
        byParent.set(p, [...(byParent.get(p) ?? []), it])
      }
      const walk = (p: string, depth: number, inLock: boolean) => {
        for (const it of byParent.get(p) ?? []) {
          const under = inLock || it.name === lockClass
          if (under) lockedIn.add(it.name)
          const sub = byParent.get(it.name) ?? []
          if (!onlyLive || it.live || sub.length) row(it, depth, sub.length > 0, true)
          walk(it.name, depth + 1, under)
        }
      }
      walk('', 0, !lockClass)
      return out
    }
    const walk = (parent: string, depth: number) => {
      for (const it of (kids[`${lua ? 'lua' : 'cls'}:${parent}`] ?? []).filter(keep)) {
        lockedIn.add(it.name)
        const isOpen = openSet.has(it.name)
        row(it, depth, it.kids > 0, isOpen, () => {
          if (!isOpen) load(it.name)
          setOpenSet((s) => {
            const x = new Set(s)
            if (x.has(it.name)) x.delete(it.name)
            else x.add(it.name)
            return x
          })
        })
        if (isOpen) walk(it.name, depth + 1)
      }
    }
    if (root) {
      // 根（Object 或 lockClass）自己也是一行；lockClass 本身能选
      const self: GtClassItem = {
        name: root,
        kind: lockLua ? 'lua' : lockClass ? (kind ?? 'object') : 'object',
        kids: 1,
      }
      lockedIn.add(root)
      const isOpen = openSet.has(root)
      row(self, 0, true, isOpen, () =>
        setOpenSet((s) => {
          const x = new Set(s)
          if (x.has(root)) x.delete(root)
          else x.add(root)
          return x
        }),
      )
      if (isOpen) walk(root, 1)
    } else walk('', 0)
    return out
    // load 只依赖 kids
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [q, found, kids, openSet, onlyLive, lua, root, value, lockClass, lockLua, kind, cn])

  const Icon = kind ? KIND_ICON[kind] : AppWindow
  const shown = value.replace(/^lua:/, '')
  return (
    <div ref={box} className="ue:relative ue:w-full ue:max-w-[380px]">
      <label
        className={cn(
          'ue:flex ue:h-8 ue:items-center ue:gap-2 ue:rounded-(--c-input-radius) ue:border-(length:--c-input-border) ue:bg-(--c-input-bg) ue:px-2.5',
          open ? 'ue:border-focus' : 'ue:border-line-strong',
        )}
      >
        <Icon className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', value ? 'ue:text-accent' : 'ue:text-subtle')} />
        <input
          value={open ? text : shown}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
          }}
          placeholder={t('填类名搜')}
          aria-label={t('类')}
          className="ue:min-w-0 ue:flex-1 ue:bg-transparent ue:font-mono ue:text-footnote ue:text-fg ue:outline-none ue:placeholder:font-sans ue:placeholder:text-subtle"
        />
        {value && !open && kind && (
          <span className="ue:shrink-0 ue:rounded-sm ue:bg-hover ue:px-1.5 ue:text-caption ue:text-subtle">
            {kindLabel(kind)}
          </span>
        )}
        <button
          type="button"
          aria-label={open ? t('收起') : t('展开')}
          onClick={() => setOpen(!open)}
          className="ue:flex ue:cursor-pointer ue:text-subtle ue:hover:text-fg"
        >
          <ChevronDown className="ue:h-3.5 ue:w-3.5" />
        </button>
      </label>
      {open && (
        <div className="ue:absolute ue:top-9 ue:left-0 ue:z-30 ue:flex ue:h-[420px] ue:w-[min(560px,90vw)] ue:flex-col ue:overflow-hidden ue:rounded-lg ue:border ue:border-line-strong ue:bg-card ue:shadow-pop">
          <div className="ue:px-2 ue:pt-2">
            <ClassTabs tab={tab} setTab={setTab} lock={lockClass ? (lockLua ? 'lua' : 'class') : undefined} />
          </div>
          <div className="ue:flex ue:items-center ue:gap-1.5 ue:px-2.5 ue:py-1.5 ue:text-footnote ue:text-fg">
            <Checkbox checked={onlyLive} label={t('只看此刻有实例的')} onChange={setOnlyLive} />
            {t('只看此刻有实例的')}
            <span className="ue:text-subtle">{t('· 引擎自带的类压灰')}</span>
          </div>
          {error && <p className="ue:px-3 ue:py-1 ue:text-footnote ue:text-danger">{error}</p>}
          {!error && !lines.length && (
            <p className="ue:px-3 ue:py-4 ue:text-center ue:text-footnote ue:text-subtle">
              {q ? t('没有名字里含 {q} 的类', { q }) : t('读类树…')}
            </p>
          )}
          <TreeList lines={lines} label={t('类')} />
          {found?.note && (
            <p className="ue:border-t ue:border-line ue:px-3 ue:py-1 ue:text-caption ue:text-warning">{found.note}</p>
          )}
          {found?.hasMore && (
            <p className="ue:border-t ue:border-line ue:px-3 ue:py-1 ue:text-caption ue:text-subtle">
              {t('只列了前 {n} 个，多打几个字缩小范围', { n: found.items.length })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** 两个页签；类定死时只留它所在的那个能点 */
function ClassTabs({ tab, setTab, lock }: { tab: Tab; setTab: (t: Tab) => void; lock?: Tab }) {
  const { ui } = h()
  return (
    <ui.Segmented
      size="sm"
      label={t('类树 / Lua 类')}
      value={tab}
      onChange={(v: Tab) => setTab(v)}
      options={[
        { id: 'class' as const, label: t('UObject 类树'), disabled: lock === 'lua' },
        { id: 'lua' as const, label: t('Lua 类'), disabled: lock === 'class' },
      ]}
    />
  )
}
