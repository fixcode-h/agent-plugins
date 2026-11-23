import { AppWindow, ChevronDown, X } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { GtClassItem } from '../../../../../shared/gt-script/index.ts'
import { CornerHandle, useCornerSize } from '../../../../corner-resize.tsx'
import { Checkbox } from '../../../../details/controls.tsx'
import { h, t } from '../../../../host.ts'
import { TreeList } from '../../../../TreeList.tsx'
import { ancestors, luaDirOf, useClassIndex } from './class-index.ts'
import { classLines } from './class-lines.tsx'
import { useLuaExclude } from './use-lua-exclude.ts'
import { ScreenTree } from './ScreenTree.tsx'
import type { ClassKind } from './data.ts'
import { KIND_ICON, kindLabel } from './kind-icon.ts'

// 图标和种类名挪到 kind-icon.ts（class-lines.tsx 也要用，免得互相 import）；这里转出去给已有的调用方
export { KIND_ICON, kindLabel }

type Tab = 'class' | 'lua' | 'screen'
const ROOT = 'Object'

/**
 * 顶栏的类下拉（效果图 2）：框里直接打字搜（类名里含这几个字就算），下拉里三个页签「UObject 类树」「Lua 类」「屏幕上」。
 * 类表整张记在本地索引里（class-index.ts，用户 2026-11-23：每次打开都「读类树…」、打字结果不跟着变）：
 * 打开马上显示、展开一层和打字搜都在本地算，后台核对一次有没有变。
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
  const [open, setOpen] = useState(false)
  const lockLua = !!lockClass?.startsWith('lua:')
  const [tab, setTab] = useState<Tab>(lockLua || value.startsWith('lua:') ? 'lua' : 'class')
  const [text, setText] = useState('')
  const [onlyLive, setOnlyLive] = useState(false)
  const [openSet, setOpenSet] = useState<Set<string>>(new Set())
  const box = useRef<HTMLDivElement>(null)
  // 下拉弹层右下角能拖大，记住大小（用户 2026-11-21）
  const pop = useCornerSize('gtref.classPicker', { w: 560, h: 420 }, { w: 360, h: 240 })
  const ex = useLuaExclude(project)
  const lua = tab === 'lua'
  const screenTab = tab === 'screen'
  const { ix, error, syncing } = useClassIndex(project, lua, open && !screenTab)
  const choose = (cls: string, it: GtClassItem) => {
    onPick(cls, it)
    setOpen(false)
    setText('')
  }
  // 树从哪一层开始：定了类的从它开始；UObject 类树从 Object 开始；Lua 类没有公共的根
  const root = lockClass ? lockClass.replace(/^lua:/, '') : lua ? '' : ROOT
  // Lua 不定类时从最顶层按目录列，点开模块再按父类看子类
  const byDir = lua && !lockClass

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
  // 打字即搜（本地索引上算，不等停手）：useDeferredValue 让输入框先跟手，树在空闲时跟上；
  // 框里还是当前类名（打开时填进去的）不算搜，树照常显示并定位到它
  const typed = text.trim() === shown ? '' : text.trim()
  const q = useDeferredValue(typed)

  const toggle = useCallback(
    (id: string) =>
      setOpenSet((s) => {
        const x = new Set(s)
        if (x.has(id)) x.delete(id)
        else x.add(id)
        return x
      }),
    [],
  )

  // 再次打开下拉时定位到已选的类（用户 2026-11-21）：切到它的页签，展开到它那一层，滚到它
  const [revealSeq, setRevealSeq] = useState(0)
  useEffect(() => {
    if (!open || !value || lockClass) return
    setTab(value.startsWith('lua:') ? 'lua' : 'class')
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  // 索引到了（或换了）再展开祖先：先打开、后到索引的也能定位
  useEffect(() => {
    if (!open || !value || !ix) return
    const isLua = value.startsWith('lua:')
    if (isLua !== lua) return
    const name = value.replace(/^lua:/, '')
    const up = [root, ...ancestors(ix, name, root)]
    if (isLua && !lockClass) {
      const parts = luaDirOf(name).split('/').filter(Boolean)
      up.push(...parts.map((_, i) => `dir:${parts.slice(0, i + 1).join('/')}`))
    }
    setOpenSet((s) => new Set([...s, ...up]))
    setRevealSeq((n) => n + 1)
    // 只在打开、索引换了、页签换了时定位，不跟着 value 每次变
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ix, lua])
  // 根默认展开
  useEffect(() => {
    if (open && root) setOpenSet((s) => (s.has(root) ? s : new Set([...s, root])))
  }, [open, root])

  // onPick 每次渲染可能是新函数：放进 ref，免得父组件一渲染就把整棵树重摊一遍
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const pick = useCallback(
    (it: GtClassItem) => {
      onPickRef.current(lua ? `lua:${it.name}` : it.name, it)
      setOpen(false)
      setText('')
    },
    [lua],
  )
  const {
    lines,
    total,
    shown: listed,
  } = useMemo(
    () =>
      ix
        ? classLines({
            ix,
            q,
            lua,
            byDir,
            root,
            lockClass,
            lockLua,
            kind,
            value,
            onlyLive,
            openSet,
            toggle,
            pick,
            ex,
            cn,
          })
        : { lines: [], total: 0, shown: 0 },
    [ix, q, lua, byDir, root, lockClass, lockLua, kind, value, onlyLive, openSet, toggle, pick, ex, cn],
  )

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
              {error && !ix && <p className="ue:px-3 ue:py-1 ue:text-footnote ue:text-danger">{error}</p>}
              {!error && !lines.length && (
                <p className="ue:px-3 ue:py-4 ue:text-center ue:text-footnote ue:text-subtle">
                  {!ix ? t('读类树…') : q ? t('没有名字里含 {q} 的类', { q }) : t('没有类')}
                </p>
              )}
              <TreeList
                lines={lines}
                label={t('类')}
                reveal={revealKey ? { key: revealKey, seq: revealSeq } : undefined}
              />
              {ix?.note && (
                <p className="ue:border-t ue:border-line ue:px-3 ue:py-1 ue:text-caption ue:text-warning">{ix.note}</p>
              )}
              {(total > listed || (syncing && ix)) && (
                <p className="ue:flex ue:gap-2 ue:border-t ue:border-line ue:px-3 ue:py-1 ue:text-caption ue:text-subtle">
                  {total > listed && (
                    <span>{t('命中 {total} 个，只列了前 {n} 个，多打几个字缩小范围', { total, n: listed })}</span>
                  )}
                  {syncing && ix && <span className="ue:ml-auto">{t('正在核对类表有没有变…')}</span>}
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
