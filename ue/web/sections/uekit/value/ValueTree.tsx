import { Box, Braces, Check, ChevronRight, List, X } from 'lucide-react'
import { useContext, useState, type ReactNode } from 'react'
import { shapeOf } from '../../../../shared/gm/type-match.ts'
import { Ctx } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { useProps } from '../gt-ref/live.ts'

/**
 * 一个运行时的值按类型画出来（用户 2026-11-22：返回值、当前值、抓取的值都不要只是一段文字，做成统一的一套）。
 * 布尔是勾 / 叉，数字、文字、枚举各有颜色和样子，向量 / 旋转按分量排开，颜色带色块，数组 / 表 / 结构体能展开，
 * UObject（GameTest 2.2.1 起带类型 JSON 的 {"$obj": 路径, class, name}）展开时按路径用 gt.props 读它此刻的成员（只读一次，不轮询）。
 * 截断的容器写 {"$more": 个数}。type 是 UE / Lua 的类型字符串，拿来区分枚举和文字、结构体名字
 */
const INDENT = 14

type ObjRefVal = { $obj: string; class?: string; name?: string }
export const isObjRef = (v: unknown): v is ObjRefVal =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { $obj?: unknown }).$obj === 'string'
const moreOf = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { $more?: unknown }).$more === 'number'
    ? (v as { $more: number }).$more
    : undefined
const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const nums = (v: Record<string, unknown>, keys: string[]) =>
  keys.every((k) => typeof v[k] === 'number') && Object.keys(v).length === keys.length
const VEC = [
  ['X', 'Y', 'Z'],
  ['X', 'Y'],
  ['Pitch', 'Yaw', 'Roll'],
  ['X', 'Y', 'Z', 'W'],
]
const vecKeys = (v: Record<string, unknown>) => VEC.find((k) => nums(v, k))
const isColor = (v: Record<string, unknown>) => nums(v, ['R', 'G', 'B', 'A']) || nums(v, ['R', 'G', 'B'])
const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000))

/** 颜色色块：FLinearColor 是 0–1，FColor 是 0–255 */
function Swatch({ c }: { c: Record<string, number> }) {
  const big = [c.R, c.G, c.B].some((x) => x > 1)
  const ch = (x: number) => Math.round(Math.max(0, Math.min(1, big ? x / 255 : x)) * 255)
  const a = c.A === undefined ? 1 : big ? c.A / 255 : c.A
  return (
    <span
      className="ue:inline-block ue:h-3 ue:w-3 ue:shrink-0 ue:rounded-sm ue:border ue:border-line"
      style={{ background: `rgba(${ch(c.R)}, ${ch(c.G)}, ${ch(c.B)}, ${a})` }}
    />
  )
}

/** gt.props 里对象属性的值是路径字符串：按类型认成对象（显示名字、能展开看成员） */
const asObj = (v: unknown, type?: string): unknown =>
  typeof v === 'string' && v.includes('/') && shapeOf(type).k === 'obj' ? { $obj: v, name: v.split(/[.:]/).pop() } : v

/** 一个值的一行样子（不展开的部分） */
export function ValueBrief({ v: raw, type }: { v: unknown; type?: string }): ReactNode {
  const shape = shapeOf(type)
  const v = asObj(raw, type)
  if (v === null || v === undefined) return <span className="ue:text-subtle">{shape.k === 'obj' ? 'None' : 'nil'}</span>
  if (typeof v === 'boolean')
    return (
      <span
        className={
          v
            ? 'ue:inline-flex ue:items-center ue:gap-1 ue:text-success'
            : 'ue:inline-flex ue:items-center ue:gap-1 ue:text-muted'
        }
      >
        {v ? <Check className="ue:h-3.5 ue:w-3.5" /> : <X className="ue:h-3.5 ue:w-3.5" />}
        {String(v)}
      </span>
    )
  if (typeof v === 'number') return <span className="ue:text-accent">{fmtNum(v)}</span>
  if (typeof v === 'string')
    return shape.k === 'enum' ? (
      <span className="ue:rounded-sm ue:bg-hover ue:px-1.5 ue:text-fg">{v}</span>
    ) : (
      <span className="ue:text-success">"{v}"</span>
    )
  if (isObjRef(v))
    return (
      <span className="ue:inline-flex ue:min-w-0 ue:items-center ue:gap-1.5">
        <span className="ue:truncate ue:text-fg">{v.name ?? v.$obj}</span>
        {v.class && (
          <span className="ue:shrink-0 ue:rounded-sm ue:bg-hover ue:px-1 ue:text-caption ue:text-muted">{v.class}</span>
        )}
      </span>
    )
  if (isRec(v)) {
    if (isColor(v))
      return (
        <span className="ue:inline-flex ue:items-center ue:gap-1.5">
          <Swatch c={v as Record<string, number>} />
          <Parts v={v} keys={Object.keys(v)} />
        </span>
      )
    const vk = vecKeys(v)
    if (vk) return <Parts v={v} keys={vk} />
  }
  if (Array.isArray(v)) {
    const n = v.length - (moreOf(v.at(-1)) !== undefined ? 1 : 0) + (moreOf(v.at(-1)) ?? 0)
    return <span className="ue:text-subtle">{t('数组 · {n} 项', { n })}</span>
  }
  const keys = Object.keys(v as object).filter((k) => k !== '$more')
  const name = shape.k === 'struct' ? shape.name : t('表')
  return <span className="ue:text-subtle">{t('{name} · {n} 个字段', { name, n: keys.length + (moreOf(v) ?? 0) })}</span>
}

/** 向量、旋转、颜色按分量排开：X 1  Y 2  Z 3 */
function Parts({ v, keys }: { v: Record<string, unknown>; keys: string[] }) {
  return (
    <span className="ue:inline-flex ue:flex-wrap ue:items-center ue:gap-x-2">
      {keys.map((k) => (
        <span key={k} className="ue:inline-flex ue:items-center ue:gap-1">
          <span className="ue:text-caption ue:text-subtle">{k}</span>
          <span className="ue:text-accent">{fmtNum(v[k] as number)}</span>
        </span>
      ))}
    </span>
  )
}

/** 对象的成员：展开时才读 */
function ObjMembers({ project, path, depth }: { project: string; path: string; depth: number }) {
  const p = useProps(project, { path })
  const items = (p.data?.groups ?? []).flatMap((g) => g.items).filter((x) => !x.luaFn)
  const pad = { paddingLeft: `${6 + depth * INDENT + 18}px` }
  const note = (text: string, cls = 'ue:text-subtle') => (
    <div style={pad} className={`ue:py-0.5 ${cls}`}>
      {text}
    </div>
  )
  if (p.error) return note(p.error, 'ue:text-danger')
  if (p.loading && !p.data) return note(t('读取中…'))
  if (!items.length) return note(t('没有成员'))
  return (
    <>
      {items.map((it) => (
        <Row key={it.prop} project={project} k={it.name} v={it.value} type={it.type} depth={depth} />
      ))}
    </>
  )
}

/** 能展开的才有子项：数组、表、结构体（向量 / 颜色这种一行写得下的不展开）、对象 */
function kidsOf(v: unknown): [string, unknown][] {
  if (Array.isArray(v)) return v.map((x, i) => [String(i), x])
  if (!isRec(v) || isObjRef(v) || isColor(v) || vecKeys(v)) return []
  return Object.entries(v).filter(([key]) => key !== '$more')
}

function Row({
  project,
  k,
  v,
  type,
  depth,
  open: open0 = false,
}: {
  project?: string
  k?: string
  v: unknown
  type?: string
  depth: number
  open?: boolean
}) {
  const { cn } = h()
  const [open, setOpen] = useState(open0)
  v = asObj(v, type)
  const more = moreOf(v)
  if (more !== undefined && Object.keys(v as object).length === 1)
    return (
      <div style={{ paddingLeft: `${6 + depth * INDENT + 18}px` }} className="ue:py-0.5 ue:text-subtle">
        {t('还有 {n} 项没列出', { n: more })}
      </div>
    )
  const obj = isObjRef(v) && !!project
  const kids = kidsOf(v)
  const can = obj || kids.length > 0
  const Icon = isObjRef(v) ? Box : Array.isArray(v) ? List : Braces
  const shape = shapeOf(type)
  const elemType = shape.k === 'arr' ? /^TArray<(.+)>$/.exec(type ?? '')?.[1] : undefined
  return (
    <>
      <button
        type="button"
        disabled={!can}
        title={isObjRef(v) ? v.$obj : undefined}
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
        {(can || isObjRef(v)) && <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />}
        {k !== undefined && <span className="ue:shrink-0 ue:text-muted">{k}</span>}
        <span className="ue:min-w-0 ue:truncate">
          <ValueBrief v={v} type={type} />
        </span>
        {type && depth > 0 && <span className="ue:ml-auto ue:shrink-0 ue:text-caption ue:text-subtle">{type}</span>}
      </button>
      {open && obj && <ObjMembers project={project} path={(v as ObjRefVal).$obj} depth={depth + 1} />}
      {open &&
        kids.map(([key, x]) => (
          <Row
            key={key}
            project={project}
            k={Array.isArray(v) ? `[${key}]` : key}
            v={x}
            type={elemType}
            depth={depth + 1}
          />
        ))}
      {open && !isObjRef(v) && more !== undefined && (
        <div style={{ paddingLeft: `${6 + (depth + 1) * INDENT + 18}px` }} className="ue:py-0.5 ue:text-subtle">
          {t('还有 {n} 项没列出', { n: more })}
        </div>
      )}
    </>
  )
}

/**
 * 值的树：一个根行，默认展开第一层。GM 调函数的输出、改变量的当前值、抓取值弹窗都用这一份。
 * project 不给时按 UE 页的项目（对象要展开成员才用得到；不在 UE 页里时对象不能展开）
 */
export function ValueTree({
  value,
  type,
  project,
  collapsed,
}: {
  value: unknown
  type?: string
  project?: string
  /** 根行先收起（改变量的当前值：对象展开太高，会把「修改」挤出去） */
  collapsed?: boolean
}) {
  const ue = useContext(Ctx)
  return (
    <div className="ue:flex ue:flex-col ue:font-mono ue:text-footnote">
      <Row project={project ?? ue?.project.id} v={value} type={type} depth={0} open={!collapsed} />
    </div>
  )
}
