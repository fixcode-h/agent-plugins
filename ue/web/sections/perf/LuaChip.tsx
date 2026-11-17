import { Braces, ChevronDown, Info } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cmpVersion } from '../../../server/semver.ts'
import { ppost } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useTargetInfo } from '../../ui.tsx'

/**
 * 录制控件里的「Lua」开关（Lua 性能分析设计稿 5.1、9.3）：和预设独立叠加，任何预设都能带上 Lua。
 * 开关和「C 函数单独成块」记在项目设置里（UeProject.perfLua，不放浏览器）；没改过时装了 UnLua 就开、C 函数单独成块。
 * 发给服务端的值：true = lua,luac；'noc' = 只要 lua；false = 不录 Lua。
 */
export type LuaTrace = boolean | 'noc'
const LUA_BRIDGE = '2.8.0'

/** Lua 页「去录制」留下的一次性请求：跳到性能页后录制控件把 Lua 打开（只这一次，不改项目设置） */
let wantLua = false
export function openPerfWithLua(go: (section: string, sub?: string) => void) {
  wantLua = true
  go('perf', '')
}

export function useLuaTrace() {
  const { project, state, go, reload } = useUe()
  const { inst } = useTargetInfo()
  const { toast } = h()
  const unlua = !!state?.unlua
  const [cur, setCur] = useState(() => {
    const on = wantLua || (project.perfLua?.on ?? true)
    wantLua = false
    return { on, c: project.perfLua?.c ?? true }
  })
  const old = !!inst?.bridge && cmpVersion(inst.bridge, LUA_BRIDGE) < 0
  const on = unlua && cur.on
  const set = (next: { on: boolean; c: boolean }) => {
    setCur(next)
    // 记进项目设置：下次打开、Agent 不给 lua 时都按它
    ppost(project.id, 'settings', { perfLua: next })
      .then(reload)
      .catch((e: Error) => toast.error(e.message))
  }
  const value: LuaTrace = !on || old ? false : cur.c ? true : 'noc'
  return { unlua, on, c: cur.c, old, bridge: inst?.bridge, value, set, toPlugins: () => go('plugins') }
}
type LuaState = ReturnType<typeof useLuaTrace>

/** 芯片样式的开关，点开是一张说明卡（录 Lua、C 函数单独成块、开销说明） */
export function LuaChip({ lua }: { lua: LuaState }) {
  const { cn } = h()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const title = !lua.unlua
    ? t('项目没装 UnLua，录不了 Lua')
    : lua.old
      ? t('UELink 2.8 起支持，去 UE 插件页升级；这次照常只录 UE 部分')
      : lua.on
        ? t('一起录 Lua 函数（点开看说明）')
        : t('不录 Lua（点开打开）')
  const active = lua.on && !lua.old
  return (
    <span ref={anchor} className="ue:relative">
      <button
        type="button"
        disabled={!lua.unlua}
        aria-pressed={active}
        title={title}
        onClick={() => setOpen((x) => !x)}
        className={cn(
          'ue:inline-flex ue:h-8 ue:items-center ue:gap-1.5 ue:rounded-lg ue:border ue:px-2.5 ue:text-footnote ue:transition-colors',
          active
            ? 'ue:border-accent/40 ue:bg-accent/10 ue:text-accent'
            : 'ue:border-line ue:text-subtle ue:hover:bg-hover',
          !lua.unlua && 'ue:cursor-not-allowed ue:opacity-50',
        )}
      >
        <Braces className="ue:h-3.5 ue:w-3.5" />
        <span className={cn(!active && lua.unlua && 'ue:line-through')}>Lua</span>
        {lua.on && lua.old && <span className="ue:h-1.5 ue:w-1.5 ue:rounded-full ue:bg-warning" />}
        <ChevronDown className="ue:h-3 ue:w-3" />
      </button>
      {open && lua.unlua && (
        <Popover anchor={anchor} onClose={() => setOpen(false)}>
          <Row
            checked={lua.on}
            onChange={() => lua.set({ on: !lua.on, c: lua.c })}
            label={t('录 Lua')}
            desc={t('Lua 函数和 UE 的作用域录在同一份 trace 里；项目装了 UnLua 默认打开')}
          />
          <Row
            checked={lua.c}
            disabled={!lua.on}
            onChange={() => lua.set({ on: lua.on, c: !lua.c })}
            label={t('C 函数单独成块')}
            desc={t('UE.GetVelocity 这类 UE 接口单独显示；关掉后时间算进调用它的 Lua 函数，trace 更小')}
          />
          {lua.old && (
            <div className="ue:mt-2 ue:flex ue:items-start ue:gap-2 ue:rounded-md ue:bg-warning/10 ue:px-2 ue:py-1.5 ue:text-caption ue:text-warning">
              <span className="ue:flex-1">
                {t('UE 进程里的 UELink 是 {v}，录 Lua 要 2.8 起：这次照常只录 UE 部分', { v: lua.bridge ?? '?' })}
              </span>
              <button type="button" className="ue:shrink-0 ue:underline" onClick={lua.toPlugins}>
                {t('去 UE 插件页升级')}
              </button>
            </div>
          )}
          <div className="ue:mt-2 ue:flex ue:items-start ue:gap-1.5 ue:border-t ue:border-line ue:pt-2 ue:text-caption ue:text-subtle">
            <Info className="ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0" />
            <span>
              {t(
                '录制期间 Lua 会变慢一些，看占比不看绝对值；没在录制时没有任何开销。IDE 的 Lua 调试器连着时录不到 Lua。',
              )}
            </span>
          </div>
        </Popover>
      )}
    </span>
  )
}

function Row({
  checked,
  disabled,
  onChange,
  label,
  desc,
}: {
  checked: boolean
  disabled?: boolean
  onChange: () => void
  label: string
  desc: string
}) {
  const { cn } = h()
  return (
    <label
      className={cn(
        'ue:flex ue:items-start ue:gap-2 ue:rounded-md ue:px-1.5 ue:py-1 ue:transition-colors',
        disabled ? 'ue:opacity-50' : 'ue:cursor-pointer ue:hover:bg-hover',
      )}
    >
      <input
        type="checkbox"
        className="ue:mt-0.5 ue:accent-(--accent)"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span className="ue:flex ue:min-w-0 ue:flex-col">
        <span className="ue:text-footnote ue:font-medium ue:text-fg">{label}</span>
        <span className="ue:text-caption ue:text-subtle">{desc}</span>
      </span>
    </label>
  )
}

/** 画到 body 上、贴着芯片下沿右对齐：页头有 overflow 裁剪（和自定义通道面板同样的做法） */
function Popover({
  anchor,
  onClose,
  children,
}: {
  anchor: RefObject<HTMLSpanElement | null>
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number }>()
  useEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 6, right: Math.max(8, innerWidth - r.right) })
    }
    place()
    addEventListener('resize', place)
    return () => removeEventListener('resize', place)
  }, [anchor])
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return
      if (ref.current?.contains(e.target) || anchor.current?.contains(e.target)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('pointerdown', away)
    addEventListener('keydown', key)
    return () => {
      removeEventListener('pointerdown', away)
      removeEventListener('keydown', key)
    }
  }, [onClose, anchor])
  if (!pos) return null
  return createPortal(
    <div
      ref={ref}
      className="ue:fixed ue:z-[1000] ue:w-[min(340px,90vw)] ue:origin-top-right ue:rounded-xl ue:border ue:border-line ue:bg-card ue:p-2 ue:shadow-lg ue:motion-safe:animate-pop"
      style={{ top: pos.top, right: pos.right }}
    >
      {children}
    </div>,
    document.body,
  )
}
