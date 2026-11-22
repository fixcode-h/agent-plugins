import { Box, Braces, ChevronRight, List } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { useProps } from '../../uekit/gt-ref/live.ts'

/**
 * 调函数返回值的树（用户 2026-11-22：返回的 UObject、Lua 表、数组、结构体都要看得清，对象能看里面的成员）。
 * 数据是 GameTest 2.2.1 起 invoke.value 的带类型 JSON：对象 {"$obj": 路径, class, name}，数组 / 表保留层级，
 * 截断的写 {"$more": 个数}。对象展开时用 gt.props 按路径读它此刻的成员（只读一次，不轮询）
 */
const INDENT = 14

type ObjRefVal = { $obj: string; class?: string; name?: string }
const isObjRef = (v: unknown): v is ObjRefVal =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { $obj?: unknown }).$obj === 'string'
const moreOf = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { $more?: unknown }).$more === 'number'
    ? (v as { $more: number }).$more
    : undefined

/** 一个值的一行摘要 */
function brief(v: unknown): ReactNode {
  if (v === null || v === undefined) return <span className="ue:text-subtle">nil</span>
  if (typeof v === 'string') return <span className="ue:text-success">"{v}"</span>
  if (typeof v === 'number' || typeof v === 'boolean') return <span className="ue:text-accent">{String(v)}</span>
  if (isObjRef(v))
    return (
      <span className="ue:text-fg">
        {v.name ?? v.$obj} <span className="ue:text-subtle">{v.class}</span>
      </span>
    )
  if (Array.isArray(v)) {
    const n = v.length - (moreOf(v.at(-1)) !== undefined ? 1 : 0) + (moreOf(v.at(-1)) ?? 0)
    return <span className="ue:text-subtle">{t('数组 · {n} 项', { n })}</span>
  }
  const keys = Object.keys(v as object).filter((k) => k !== '$more')
  return <span className="ue:text-subtle">{t('表 · {n} 个字段', { n: keys.length + (moreOf(v) ?? 0) })}</span>
}

/** 对象的成员：展开时才读 */
function ObjMembers({ path, depth }: { path: string; depth: number }) {
  const { project } = useUe()
  const p = useProps(project.id, { path })
  const items = (p.data?.groups ?? []).flatMap((g) => g.items).filter((x) => !x.luaFn)
  const pad = { paddingLeft: `${6 + depth * INDENT + 18}px` }
  if (p.error)
    return (
      <div style={pad} className="ue:py-0.5 ue:text-danger">
        {p.error}
      </div>
    )
  if (p.loading && !p.data)
    return (
      <div style={pad} className="ue:py-0.5 ue:text-subtle">
        {t('读取中…')}
      </div>
    )
  if (!items.length)
    return (
      <div style={pad} className="ue:py-0.5 ue:text-subtle">
        {t('没有成员')}
      </div>
    )
  return (
    <>
      {items.map((it) => (
        <Row key={it.prop} k={it.name} v={it.value} depth={depth} hint={it.type} />
      ))}
    </>
  )
}

function Row({
  k,
  v,
  depth,
  hint,
  open: open0 = false,
}: {
  k?: string
  v: unknown
  depth: number
  hint?: string
  open?: boolean
}) {
  const { cn } = h()
  const [open, setOpen] = useState(open0)
  const more = moreOf(v)
  if (more !== undefined && Object.keys(v as object).length === 1)
    return (
      <div style={{ paddingLeft: `${6 + depth * INDENT + 18}px` }} className="ue:py-0.5 ue:text-subtle">
        {t('还有 {n} 项没列出', { n: more })}
      </div>
    )
  const obj = isObjRef(v)
  const kids = !obj && v && typeof v === 'object' ? Object.entries(v as object).filter(([key]) => key !== '$more') : []
  const can = obj || kids.length > 0
  const Icon = obj ? Box : Array.isArray(v) ? List : Braces
  return (
    <>
      <button
        type="button"
        disabled={!can}
        title={obj ? v.$obj : undefined}
        onClick={() => setOpen((o) => !o)}
        style={{ paddingLeft: `${6 + depth * INDENT}px` }}
        className={cn(
          'ue:flex ue:min-h-6 ue:w-full ue:items-center ue:gap-1.5 ue:rounded-md ue:pr-2 ue:text-left',
          can ? 'ue:cursor-pointer ue:hover:bg-hover' : 'ue:cursor-default',
        )}
      >
        <ChevronRight
          className={cn(
            'ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle ue:transition-transform',
            !can && 'ue:invisible',
            open && 'ue:rotate-90',
          )}
        />
        {can && <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />}
        {k !== undefined && <span className="ue:shrink-0 ue:text-muted">{k}</span>}
        {k !== undefined && <span className="ue:text-subtle">=</span>}
        <span className="ue:min-w-0 ue:truncate">{brief(v)}</span>
        {hint && <span className="ue:ml-auto ue:shrink-0 ue:text-caption ue:text-subtle">{hint}</span>}
      </button>
      {open && obj && <ObjMembers path={v.$obj} depth={depth + 1} />}
      {open &&
        kids.map(([key, x]) => (
          <Row key={key} k={Array.isArray(v) ? `[${Number(key) + 1}]` : key} v={x} depth={depth + 1} />
        ))}
      {open && !obj && more !== undefined && (
        <div style={{ paddingLeft: `${6 + (depth + 1) * INDENT + 18}px` }} className="ue:py-0.5 ue:text-subtle">
          {t('还有 {n} 项没列出', { n: more })}
        </div>
      )}
    </>
  )
}

/** 返回值：一个根行，默认展开第一层 */
export function ValueTree({ value }: { value: unknown }) {
  return (
    <div className="ue:flex ue:flex-col ue:font-mono ue:text-footnote">
      <Row v={value} depth={0} open />
    </div>
  )
}
