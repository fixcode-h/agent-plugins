import type { ReactNode } from 'react'
import { h, t } from '../../host.ts'
import { useLuaTrace } from './lua-trace.ts'

/**
 * 时间轴标题栏的两个 Lua 开关（Lua 性能 Insights 化设计 5.2、4.4）：「只看 Lua」非 Lua 块变淡但保留结构，
 * 「C 函数并进调用者」隐藏 C 函数块（计时器表、火焰图也按它合并）。样式和计时器表的 GPU / CPU 开关一样，只在 trace 含 Lua 时出现。
 */
export function LuaToggles() {
  const lua = useLuaTrace()
  if (!lua.info.lua) return null
  return (
    <span className="ue:flex ue:items-center ue:gap-1">
      <Chip on={lua.luaOnly} onClick={() => lua.setLuaOnly(!lua.luaOnly)} title={t('非 Lua 的块变淡，还能看出是从哪个 UE 回调进来的')}>
        {t('只看 Lua')}
      </Chip>
      <Chip
        on={lua.mergeC}
        onClick={() => lua.setMergeC(!lua.mergeC)}
        title={t('UE.*、lua.* 这类 C 函数不单独成块，时间算进调用它的 Lua 函数（只是显示上合并，不用重录）')}
      >
        {t('C 函数并进调用者')}
      </Chip>
    </span>
  )
}

export function Chip({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean
  onClick: () => void
  title?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={h().cn(
        'ue:rounded-md ue:px-1.5 ue:py-0.5 ue:text-caption ue:whitespace-nowrap ue:transition-colors',
        on ? 'ue:bg-accent/15 ue:text-accent' : 'ue:bg-hover ue:text-subtle ue:hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}
