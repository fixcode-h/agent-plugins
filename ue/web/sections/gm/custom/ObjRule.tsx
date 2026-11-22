import { AppWindow, Boxes, Check, CodeXml, Cpu, User } from 'lucide-react'
import type { GmRef } from '../../../../shared/gm/schema.ts'
import { h, t } from '../../../host.ts'
import { PathChips } from '../../../path-chips/PathChips.tsx'
import { identLeaves, isIdentGroup } from '../../../../shared/gt-script/ref/ident-tree.ts'
import type { GtIdentNode } from '../../../../shared/gt-script/ref/types.ts'
import { classShort, identTreeText } from '../../uekit/gt-ref/describe.ts'

/** 对象的两种写法：匹配规则 ref，或来源字符串 src */
export interface ObjLike {
  ref?: GmRef
  src?: string
}

const fmt = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

/** 来源字符串的友好名：玩家、子系统 X、Lua 模块 X */
export function srcText(src: string) {
  if (src === '@pawn') return t('玩家')
  const m = /^@(\w+)\.(.+)$/.exec(src)
  if (m?.[1] === 'sub') return t('子系统 {n}', { n: m[2] })
  if (m?.[1] === 'luaMod') return t('Lua 模块 {n}', { n: m[2] })
  return src
}

/** 按「在哪找」和类配图标：屏上界面、Lua、Actor（和效果图一致） */
export function iconOf(o: ObjLike) {
  if (o.src === '@pawn') return User
  if (o.src?.startsWith('@luaMod.') || o.ref?.class.startsWith('lua:')) return CodeXml
  if (o.src) return Cpu
  const inn = o.ref?.in
  const list = Array.isArray(inn) ? inn : [inn]
  if (list.includes('screen') || /^W(BP|_)/.test(classShort(o.ref?.class))) return AppWindow
  return Boxes
}

/**
 * 一条匹配规则的友好写法（效果图 1、2）：类 · 标识小块 = 值；只按类的写「只按类」。界面上不出现属性路径的符号（PathChips）
 */
/** noIcon：前面已经有图标的地方（对象列表的树行）不再画一个 */
export function ObjRule({ o, small, noIcon }: { o: ObjLike; small?: boolean; noIcon?: boolean }) {
  const { cn } = h()
  const Icon = iconOf(o)
  const lua = !!o.src?.startsWith('@luaMod.') || !!o.ref?.class.startsWith('lua:')
  const nodes = (o.ref?.ident as GtIdentNode[] | undefined) ?? []
  // 写了条件组（2.1.6）时小块摆不下且 / 或、括号：整句写出来
  const grouped = nodes.some(isIdentGroup)
  const ident = grouped ? [] : identLeaves(nodes)
  return (
    <span
      className={cn(
        'ue:inline-flex ue:min-w-0 ue:items-center ue:gap-1 ue:whitespace-nowrap',
        small ? 'ue:text-caption' : 'ue:text-footnote',
      )}
    >
      {!noIcon && <Icon className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', lua ? 'ue:text-muted' : 'ue:text-accent')} />}
      <span className="ue:font-mono ue:text-fg">
        {o.src ? srcText(o.src) : classShort(o.ref?.class.replace(/^lua:/, ''))}
      </span>
      {lua && <span className="ue:rounded-sm ue:bg-hover ue:px-1 ue:text-caption ue:text-muted">Lua</span>}
      {ident.map((x) => (
        <span key={x.prop} className="ue:inline-flex ue:items-center ue:gap-1">
          <span className="ue:text-subtle">·</span>
          <PathChips path={x.prop} small />
          {x.value !== undefined && <span className="ue:text-fg">= {fmt(x.value)}</span>}
        </span>
      ))}
      {grouped && (
        <span className="ue:min-w-0 ue:truncate ue:text-fg">
          <span className="ue:text-subtle">· </span>
          {identTreeText(nodes)}
        </span>
      )}
      {!o.src && !nodes.length && <span className="ue:text-subtle">· {t('只按类')}</span>}
    </span>
  )
}

/** 命中几个：1 绿、多个黄、0 灰；没连游戏（undefined）不显示 */
export function HitBadge({ n, error }: { n?: number; error?: string }) {
  const { cn } = h()
  if (error)
    return (
      <span className="ue:shrink-0 ue:text-caption ue:text-danger" title={error}>
        {t('找不到')}
      </span>
    )
  if (n === undefined) return null
  return (
    <span
      className={cn(
        'ue:inline-flex ue:shrink-0 ue:items-center ue:gap-0.5 ue:rounded-sm ue:px-1.5 ue:py-px ue:text-caption',
        n === 1
          ? 'ue:bg-success/15 ue:text-success'
          : n > 1
            ? 'ue:bg-warning/15 ue:text-warning'
            : 'ue:bg-hover ue:text-subtle',
      )}
    >
      {n === 1 && <Check className="ue:h-3 ue:w-3" />}
      {t('命中 {n} 个', { n })}
    </span>
  )
}

/** 「Agent 加的」小徽标（规格第 9 节） */
export const AgentBadge = () => (
  <span className="ue:rounded-sm ue:bg-accent-soft ue:px-1 ue:text-caption ue:text-accent">{t('Agent 加的')}</span>
)

/** 对象名小块（「会执行」里、对象参数下拉里） */
export const ObjName = ({ name }: { name: string }) => (
  <span className="ue:shrink-0 ue:rounded-sm ue:bg-sel ue:px-1.5 ue:py-px ue:text-footnote ue:text-fg">{name}</span>
)
