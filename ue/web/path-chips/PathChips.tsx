import {
  Activity,
  Box,
  ChevronRight,
  CodeXml,
  Database,
  List,
  SquareFunction,
  Variable,
  type LucideIcon,
} from 'lucide-react'
import { parsePropPath, type GtPathSegKind } from '../../shared/gt-script/ref/path.ts'
import { h, t } from '../host.ts'

/** 每种段的图标和悬停说明（界面不出现 / . # : 这些符号，用户 2026-11-21） */
const SEG: Record<GtPathSegKind, { icon: LucideIcon; tip: () => string }> = {
  child: { icon: Box, tip: () => t('子控件 / 组件') },
  prop: { icon: Variable, tip: () => t('属性') },
  fn: { icon: SquareFunction, tip: () => t('方法（无参取值）') },
  lua: { icon: CodeXml, tip: () => t('Lua 字段') },
  state: { icon: Activity, tip: () => t('运行状态') },
  index: { icon: List, tip: () => t('第几项 / 键') },
}

/**
 * 属性路径的友好显示：小块 + ›。标识组、条件、步骤详情、GM 详情共用。
 * `childIcon` 给子控件 / 组件按它自己的类配图标（和结构树一致），`stateName` 把运行状态翻成中文名。
 */
export function PathChips({
  path,
  small,
  childIcon,
  stateName,
}: {
  path: string
  small?: boolean
  childIcon?: (name: string) => LucideIcon | undefined
  stateName?: (name: string) => string | undefined
}) {
  const { cn } = h()
  const p = parsePropPath(path)
  // 写法不对时原样显示（只会出现在手改坏的脚本上，校验会另外报）
  if ('error' in p) return <span className="ue:font-mono ue:text-caption ue:text-danger">{path}</span>
  const segs = p.root === 'item' ? [{ kind: 'item' as const, name: t('条目数据') }, ...p.segs] : p.segs
  return (
    <span
      className={cn(
        'ue:inline-flex ue:min-w-0 ue:items-center ue:gap-0.5',
        small ? 'ue:flex-nowrap ue:whitespace-nowrap' : 'ue:flex-wrap',
      )}
    >
      {segs.map((s, i) => {
        const d = s.kind === 'item' ? { icon: Database, tip: () => t('列表条目的数据对象') } : SEG[s.kind]
        const Icon = (s.kind === 'child' && childIcon?.(s.name)) || d.icon
        const label = s.kind === 'state' ? (stateName?.(s.name) ?? s.name) : s.name
        return (
          <span key={i} className="ue:inline-flex ue:items-center ue:gap-0.5">
            {i > 0 && <ChevronRight className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />}
            <span
              title={d.tip()}
              className={cn(
                'ue:inline-flex ue:items-center ue:gap-1 ue:rounded-sm ue:px-1.5 ue:py-px ue:text-fg',
                small ? 'ue:text-caption' : 'ue:text-footnote',
                s.kind === 'child' ? 'ue:bg-sel' : 'ue:bg-hover',
              )}
            >
              <Icon
                className={cn('ue:h-3 ue:w-3 ue:shrink-0', s.kind === 'child' ? 'ue:text-accent' : 'ue:text-muted')}
              />
              {s.kind === 'index' && /^\d+$/.test(s.name) ? t('第 {n} 项', { n: s.name }) : label}
            </span>
          </span>
        )
      })}
    </span>
  )
}
