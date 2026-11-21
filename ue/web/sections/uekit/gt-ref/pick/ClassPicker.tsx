import {
  AppWindow,
  Box,
  Boxes,
  ChevronDown,
  CodeXml,
  Component,
  Folder,
  Eye,
  EyeOff,
  FolderOpen,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GtClassItem, GtClassesResult } from '../../../../../shared/gt-script/index.ts'
import { searchText } from '../../../../../shared/gt-script/ref/search-text.ts'
import { CornerHandle, useCornerSize } from '../../../../corner-resize.tsx'
import { Checkbox } from '../../../../details/controls.tsx'
import { h, t } from '../../../../host.ts'
import { TreeList, type TreeLine } from '../../../../TreeList.tsx'
import { openMenu } from '../../../../menu.tsx'
import { useRefRpc } from '../live.ts'
import { useLuaExclude } from './use-lua-exclude.ts'
import { ScreenTree } from './ScreenTree.tsx'
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

type Tab = 'class' | 'lua' | 'screen'
/** Lua 模块名的最后一段（/ 和 . 都当分隔，和 gt.classes 的 dir 一致） */
const luaLeaf = (name: string) => name.split(/[/.]/).filter(Boolean).pop() ?? name
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
  // Lua 按目录成树（用户 2026-11-21）：目录 → 下一层子目录
  const [dirs, setDirs] = useState<Record<string, { name: string; count: number }[]>>({})
  const [openSet, setOpenSet] = useState<Set<string>>(new Set())
  const [found, setFound] = useState<GtClassesResult>()
  const [error, setError] = useState('')
  const box = useRef<HTMLDivElement>(null)
  // 下拉弹层右下角能拖大，记住大小（用户 2026-11-21）
  const pop = useCornerSize('gtref.classPicker', { w: 560, h: 420 }, { w: 360, h: 240 })
  const ex = useLuaExclude(project)
  const lua = tab === 'lua'
  const screenTab = tab === 'screen'
  const choose = (cls: string, it: GtClassItem) => {
    onPick(cls, it)
    setOpen(false)
    setText('')
  }
  // 树从哪一层开始：定了类的从它开始；UObject 类树从 Object 开始；Lua 类没有公共的根
  const root = lockClass ? lockClass.replace(/^lua:/, '') : lua ? '' : ROOT

  // 点外面、Esc 关掉
  useEffect(() => {
    if (!open) return
    // 右键菜单画在弹层外面：点菜单项不算点外面
    const down = (e: MouseEvent) =>
      !box.current?.contains(e.target as Node) &&
      !(e.target as Element | null)?.closest?.('[role="menu"]') &&
      setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const shown = value.replace(/^lua:/, '')
  // 打开时框里留着当前类名并全选（用户 2026-11-21：选中了上面却是空的），直接打字就替换成搜索
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    setText(shown)
    requestAnimationFrame(() => input.current === document.activeElement && input.current?.select())
    // 只在打开那一下填；打开期间 value 变了（选中即关）不用再填
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  // 打字停一会儿再搜；框里还是当前类名（打开时填进去的）不算搜，树照常显示并定位到它
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim() === shown ? '' : text.trim()), 250)
    return () => clearTimeout(id)
  }, [text, shown])

  // Lua 不定类时从最顶层按目录列（dir），点开模块再按 parent 看子类
  const byDir = lua && !lockClass
  // asLua：打开下拉定位已选的类时页签可能还没切过来，按已选的类决定读哪棵树
  // 点「刷新」（RefDialog 换了 rpc）后的第一次读带 fresh
  const fresh = useRef(false)
  const firstRpc = useRef(rpc)
  const load = (parent: string, force = false, dir?: string, asLua = lua) => {
    const key = dir !== undefined ? `dir:${dir}` : `${asLua ? 'lua' : 'cls'}:${parent}`
    if (kids[key] && !force) return
    const wasFresh = fresh.current
    fresh.current = false
    rpc<GtClassesResult>(project, 'gt.classes', {
      ...(dir !== undefined ? { dir } : parent && parent !== ROOT ? { parent } : {}),
      ...(asLua ? { lua: true } : {}),
      // 点了「刷新」后的第一次读：让 UE / 面板别用缓存的类表（gt.classes 15 秒内复用上一次建好的）
      ...(wasFresh ? { fresh: true } : {}),
      limit: 500,
    })
      .then((r) => {
        setKids((m) => ({ ...m, [key]: r.items ?? [] }))
        if (dir !== undefined) setDirs((m) => ({ ...m, [dir]: r.dirs ?? [] }))
      })
      .catch((e: Error) => setError(e.message))
  }

  // 再次打开下拉时定位到已选的类（用户 2026-11-21）：切到它的页签，展开到它那一层，滚到它
  const [revealSeq, setRevealSeq] = useState(0)
  useEffect(() => {
    if (!open || !value) return
    const isLua = value.startsWith('lua:')
    const name = value.replace(/^lua:/, '')
    if (!lockClass) setTab(isLua ? 'lua' : 'class')
    setRevealSeq((n) => n + 1)
    if (isLua && !lockClass) {
      // Lua 按目录：把所在目录一层层打开
      const parts = name.split(/[/.]/).filter(Boolean).slice(0, -1)
      const dirsUp = parts.map((_, i) => parts.slice(0, i + 1).join('/'))
      for (const d of dirsUp) load('', false, d, true)
      setOpenSet((s) => new Set([...s, ...dirsUp.map((d) => `dir:${d}`)]))
      return
    }
    // 类树：搜一次拿到祖先链，祖先都打开
    let off = false
    rpc<GtClassesResult>(project, 'gt.classes', { q: name, ...(isLua ? { lua: true } : {}), limit: 500 })
      .then((r) => {
        if (off) return
        const byName = new Map(r.items.map((x) => [x.name, x]))
        const chain: string[] = []
        const seen = new Set<string>()
        for (let cur = byName.get(name)?.parent; cur && !seen.has(cur); cur = byName.get(cur)?.parent) {
          seen.add(cur)
          chain.push(cur)
          if (cur === root) break
        }
        for (const c of chain) load(c, false, undefined, isLua)
        setOpenSet((s) => new Set([...s, ...chain]))
      })
      .catch(() => undefined)
    return () => {
      off = true
    }
    // 只在打开下拉那一下定位；load 只依赖 kids
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 刷新（RefDialog 换了 rpc）：读过的类树作废；第一次挂上时不算刷新
  useEffect(() => {
    if (rpc !== firstRpc.current) fresh.current = true
    setKids({})
    setDirs({})
    setFound(undefined)
    setOpenSet(new Set())
  }, [rpc])

  // 打开下拉、换页签、刷新时读第一层
  useEffect(() => {
    if (!open || q || screenTab) return
    setError('')
    // 强制读：刷新后 kids 刚清掉，这里拿到的还是旧的
    if (byDir) load('', true, '')
    else load(root, true)
    setOpenSet((s) => new Set([...s, root]))
    // load 只依赖 kids（读过就跳过），不放进依赖免得读回来又触发
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, lua, root, rpc, screenTab])

  useEffect(() => {
    if (!open || !q || screenTab) return setFound(undefined)
    let off = false
    setError('')
    rpc<GtClassesResult>(project, 'gt.classes', { q, ...(lua ? { lua: true } : {}), limit: 200 })
      .then((r) => !off && setFound(r))
      .catch((e: Error) => !off && setError(e.message))
    return () => {
      off = true
    }
  }, [project, open, q, lua, rpc, screenTab])

  const lines = useMemo(() => {
    const out: TreeLine[] = []
    const lockedIn = new Set<string>()
    const pick = (it: GtClassItem) => {
      onPick(lua ? `lua:${it.name}` : it.name, it)
      setOpen(false)
      setText('')
    }
    const row = (it: GtClassItem, depth: number, expandable: boolean, isOpen: boolean, onToggle?: () => void) => {
      // Lua 模块名是完整路径，树里已经按目录分好了，只显示最后一段（搜索时也一样，目录放悬停提示）
      const name = it.kind === 'lua' ? luaLeaf(it.name) : it.name
      // 名字里含 q 就算命中（用户 2026-11-21：不要只按开头），把命中的那段标出来
      const at = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1
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
                {name.slice(0, at)}
                <b className="ue:text-accent">{name.slice(at, at + q.length)}</b>
                {name.slice(at + q.length)}
              </>
            ) : (
              name
            )}
          </span>
        ),
        aside: [
          it.kind === 'lua' ? 'Lua' : it.asset ? t('蓝图') : t('引擎 / C++'),
          it.live ? t('此刻 {n} 个', { n: it.live }) : '',
        ]
          .filter(Boolean)
          .join(' · '),
        title: [it.name, it.asset ?? it.file].filter(Boolean).join('\n'),
        expandable,
        open: isOpen,
        selected: (lua ? `lua:${it.name}` : it.name) === value,
        onToggle,
        onSelect: allowed ? () => pick(it) : undefined,
      })
    }
    const keep = (it: GtClassItem) => !onlyLive || !!it.live || it.kids > 0
    const toggle = (id: string) =>
      setOpenSet((s) => {
        const x = new Set(s)
        if (x.has(id)) x.delete(id)
        else x.add(id)
        return x
      })
    // Lua 按目录：先子目录（文件夹行），再这个目录下的模块（能点开看子类）
    // 最下面的「排除」分类：排除的目录不在树里、不参与搜索，右键或点一下恢复
    const excludedLines = () => {
      if (!ex.dirs.length) return
      const isOpen = openSet.has('excluded')
      out.push({
        key: 'excluded',
        depth: 0,
        icon: EyeOff,
        label: <span className="ue:text-subtle">{t('排除')}</span>,
        aside: String(ex.dirs.length),
        title: t('排除的目录不在树里、不参与搜索'),
        expandable: true,
        open: isOpen,
        selected: false,
        onToggle: () => toggle('excluded'),
        onSelect: () => toggle('excluded'),
      })
      if (isOpen)
        for (const d of ex.dirs)
          out.push({
            key: `excluded:${d}`,
            depth: 1,
            icon: Folder,
            label: <span className="ue:font-mono ue:opacity-55">{d}</span>,
            aside: t('恢复'),
            title: t('点一下恢复'),
            expandable: false,
            open: false,
            selected: false,
            onSelect: () => ex.remove(d),
            onMenu: (e) => openMenu(e, [{ label: t('恢复这个目录'), icon: Eye, onClick: () => ex.remove(d) }]),
          })
    }
    if (q && found && byDir) {
      // Lua 搜索也按目录成树（用户 2026-11-21）：只留模块名（最后一段）含 q 的，目录名对上不算，所在目录全部展开
      const needle = q.toLowerCase()
      const hits = found.items.filter(
        (it) => searchText(it.name, needle).includes(needle) && keep(it) && !ex.isExcluded(it.name),
      )
      const subDirs = new Map<string, Set<string>>()
      const mods = new Map<string, GtClassItem[]>()
      for (const it of hits) {
        const parts = it.name.split(/[/.]/).filter(Boolean)
        for (let i = 0; i < parts.length - 1; i++) {
          const up = parts.slice(0, i).join('/')
          subDirs.set(up, (subDirs.get(up) ?? new Set()).add(parts.slice(0, i + 1).join('/')))
        }
        const dir = parts.slice(0, -1).join('/')
        mods.set(dir, [...(mods.get(dir) ?? []), it])
      }
      const walkHit = (dir: string, depth: number) => {
        for (const d of [...(subDirs.get(dir) ?? [])].sort()) {
          out.push({
            key: `dir:${d}`,
            depth,
            icon: FolderOpen,
            label: <span className="ue:font-mono">{luaLeaf(d)}</span>,
            title: d,
            expandable: false,
            open: true,
            selected: false,
          })
          walkHit(d, depth + 1)
        }
        for (const it of mods.get(dir) ?? []) row(it, depth, false, false)
      }
      walkHit('', 0)
      excludedLines()
      return out
    }
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
    // 已经在这条路径上的不再往下走：回包里子类写成自己、父子成环时不至于无限递归把页面卡死
    const onPath = new Set<string>()
    const walk = (parent: string, depth: number) => {
      onPath.add(parent)
      for (const it of (kids[`${lua ? 'lua' : 'cls'}:${parent}`] ?? []).filter(keep)) {
        if (onPath.has(it.name)) continue
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
      onPath.delete(parent)
    }
    const walkDir = (dir: string, depth: number) => {
      for (const d of dirs[dir] ?? []) {
        if (ex.isExcluded(d.name)) continue
        const id = `dir:${d.name}`
        const isOpen = openSet.has(id)
        out.push({
          key: id,
          depth,
          icon: isOpen ? FolderOpen : Folder,
          label: <span className="ue:font-mono">{luaLeaf(d.name)}</span>,
          aside: String(d.count),
          title: d.name,
          expandable: true,
          selected: false,
          open: isOpen,
          onToggle: () => {
            if (!isOpen) load('', false, d.name)
            toggle(id)
          },
          onSelect: () => {
            if (!isOpen) load('', false, d.name)
            toggle(id)
          },
          onMenu: (e) => openMenu(e, [{ label: t('排除这个目录'), icon: EyeOff, onClick: () => ex.add(d.name) }]),
        })
        if (isOpen) walkDir(d.name, depth + 1)
      }
      for (const it of (kids[`dir:${dir}`] ?? []).filter(keep)) {
        const isOpen = openSet.has(it.name)
        row(it, depth, it.kids > 0, isOpen, () => {
          if (!isOpen) load(it.name)
          toggle(it.name)
        })
        if (isOpen) walk(it.name, depth + 1)
      }
    }
    if (byDir) {
      walkDir('', 0)
      excludedLines()
    } else if (root) {
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
  }, [q, found, kids, dirs, byDir, ex.dirs, openSet, onlyLive, lua, root, value, lockClass, lockLua, kind, cn])

  const revealKey = q ? undefined : lines.find((l) => l.selected)?.key
  const Icon = kind ? KIND_ICON[kind] : AppWindow
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
          ref={input}
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
        {value && !lockClass && (
          <button
            type="button"
            aria-label={t('清除类')}
            title={t('清除类')}
            onClick={(e) => {
              // 在 label 里：不拦的话点一下会让输入框拿到焦点、把下拉打开
              e.preventDefault()
              onPick('')
              setText('')
              setOpen(false)
            }}
            className="ue:flex ue:cursor-pointer ue:text-subtle ue:hover:text-fg"
          >
            <X className="ue:h-3.5 ue:w-3.5" />
          </button>
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
        <div
          style={{ width: `min(${pop.size.w}px, 90vw)`, height: pop.size.h }}
          // 下拉常放在 <label>（ui.Field）里：点弹层里的行，label 会把焦点送回输入框、onFocus 又把下拉打开，
          // 看起来就是「选了不关」（用户 2026-11-21 两次反馈）。点非输入框的地方时取消 label 的这个默认动作
          onClick={(e) => {
            if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
          }}
          className="ue:absolute ue:top-9 ue:left-0 ue:z-30 ue:flex ue:flex-col ue:overflow-hidden ue:rounded-lg ue:border ue:border-line-strong ue:bg-card ue:shadow-pop"
        >
          <div className="ue:px-2 ue:pt-2">
            <ClassTabs tab={tab} setTab={setTab} lock={lockClass ? (lockLua ? 'lua' : 'class') : undefined} />
          </div>
          {screenTab ? (
            <ScreenTree project={project} q={q} value={value} onPick={choose} />
          ) : (
            <>
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
              <TreeList
                lines={lines}
                label={t('类')}
                reveal={revealKey ? { key: revealKey, seq: revealSeq } : undefined}
              />
              {found?.note && (
                <p className="ue:border-t ue:border-line ue:px-3 ue:py-1 ue:text-caption ue:text-warning">
                  {found.note}
                </p>
              )}
              {found?.hasMore && (
                <p className="ue:border-t ue:border-line ue:px-3 ue:py-1 ue:text-caption ue:text-subtle">
                  {t('只列了前 {n} 个，多打几个字缩小范围', { n: found.items.length })}
                </p>
              )}
            </>
          )}
          <CornerHandle {...pop.handle} />
        </div>
      )}
    </div>
  )
}

/** 三个页签；类定死时只留它所在的那个能点 */
function ClassTabs({ tab, setTab, lock }: { tab: Tab; setTab: (t: Tab) => void; lock?: Tab }) {
  const { ui } = h()
  return (
    <ui.Segmented
      size="sm"
      label={t('类树 / Lua 类 / 屏幕上')}
      value={tab}
      onChange={(v: Tab) => setTab(v)}
      options={[
        { id: 'class' as const, label: t('UObject 类树'), disabled: lock === 'lua' },
        { id: 'lua' as const, label: t('Lua 类'), disabled: lock === 'class' },
        { id: 'screen' as const, label: t('屏幕上'), disabled: lock === 'lua' },
      ]}
    />
  )
}
