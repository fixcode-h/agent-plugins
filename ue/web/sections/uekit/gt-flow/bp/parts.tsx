import type { CSSProperties, ReactNode } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { LucideIcon } from 'lucide-react'
import { h } from '../../../../host.ts'
import type { FaceLine } from '../faces.tsx'

/**
 * 蓝图画布节点的共用部件（定稿效果图 designs/GameTest画布节点与引脚美化-效果图/E-*.png）：
 * 卡片左边一条按种类上色的竖条、图标小方块 + 名字 + 类型的头部、标题下一条分隔线、代码底色小块的内容区（条件一行一项）、
 * 「是 / 否 / 每轮」一行一个的出口、骑在边框上的圆点引脚。步骤、守护、开始节点都拼这几块，样式只在这里改。
 * 可调项读面板设置 → 组件 →「流程图节点」「流程图引脚」（--c-flowNode-*、--c-flowPin-*），带默认值，旧面板没有这些变量也照常画
 */

/** 种类的颜色：gt-blocks 的 tone 名和面板主题色同名 */
export const toneColor = (tone: string) => `var(--${tone})`

/** 出口的颜色：是 绿、否 红、否则如果 琥珀、每轮 主题色，「之后 / 下一步」灰 */
export const EXIT_TONE: Record<string, string> = {
  then: 'success',
  else: 'danger',
  elif: 'warning',
  do: 'accent',
  next: 'subtle',
}

const V = {
  radius: 'var(--c-flowNode-radius,10px)',
  bar: 'var(--c-flowNode-bar,3px)',
  tile: 'var(--c-flowNode-tile,inline-flex)',
  divider: 'var(--c-flowNode-divider,1px)',
  detail: 'var(--c-flowNode-detail,flex)',
  rowH: 'var(--c-flowNode-rowH,26px)',
  pin: 'var(--c-flowPin-size,11px)',
  ring: 'var(--c-flowPin-ring,4px)',
  pinTone: 'var(--c-flowPin-tone,currentColor)',
}

/** 节点外框：卡片底、描边、左侧色条；运行状态、选中这些外圈由调用方经 className 加 */
export function NodeCard({
  id,
  tone,
  className,
  style,
  children,
}: {
  id: string
  tone: string
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <div
      data-gt-node={id}
      className={h().cn(
        'ue:relative ue:flex ue:w-full ue:flex-col ue:border ue:border-line-strong ue:bg-card ue:text-body ue:text-fg ue:shadow-card',
        className,
      )}
      style={{ borderRadius: V.radius, ...style }}
    >
      <span
        aria-hidden
        className="ue:pointer-events-none ue:absolute ue:top-2.5 ue:bottom-2.5 ue:-left-px ue:rounded-r-[3px]"
        style={{ width: V.bar, background: toneColor(tone) }}
      />
      {children}
    </div>
  )
}

/** 图标小方块：种类色的浅底；事件节点（开始、守护）用圆的 */
export function NodeTile({ icon: Icon, tone, round }: { icon: LucideIcon; tone: string; round?: boolean }) {
  return (
    <span
      className={h().cn(
        'ue:h-6 ue:w-6 ue:shrink-0 ue:items-center ue:justify-center',
        round ? 'ue:rounded-full' : 'ue:rounded-[7px]',
      )}
      style={{
        display: V.tile,
        color: toneColor(tone),
        background: `color-mix(in oklab, ${toneColor(tone)} 15%, transparent)`,
      }}
    >
      <Icon className="ue:h-3.5 ue:w-3.5" />
    </span>
  )
}

/** 头部一行：输入引脚、图标、名字、类型、输出引脚。下面有内容时画一条分隔线 */
export function NodeHead({ children, divided }: { children: ReactNode; divided?: boolean }) {
  return (
    <div
      className="ue:relative ue:flex ue:h-10 ue:min-w-0 ue:items-center ue:gap-2 ue:px-3"
      style={divided ? { borderBottom: `${V.divider} solid var(--line)` } : undefined}
    >
      {children}
    </div>
  )
}

/** 内容区：细节、条件一行一个代码底色小块，条件行首写「且 / 或」 */
export function NodeBody({ lines, extra }: { lines: FaceLine[]; extra?: ReactNode }) {
  if (!lines.length && !extra) return null
  return (
    <div className="ue:flex-col ue:gap-1 ue:px-3 ue:py-2" style={{ display: V.detail }}>
      {lines.map((l, i) => (
        <div key={i} className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
          {l.join && (
            <span className="ue:w-[18px] ue:shrink-0 ue:text-center ue:text-caption ue:font-medium ue:text-warning">
              {l.join}
            </span>
          )}
          <span className="ue:min-w-0 ue:truncate ue:rounded-[5px] ue:bg-[var(--code-chip)] ue:px-1.5 ue:py-px ue:font-mono ue:text-caption ue:text-[var(--code-chip-fg)]">
            {l.text}
          </span>
        </div>
      ))}
      {extra}
    </div>
  )
}

/** 出口一行：右对齐的名字 + 骑在右边框上的圆点；浅色底、上面一条分隔线，颜色跟出口走 */
export function ExitRow({
  label,
  tone,
  last,
  children,
}: {
  label: string
  tone: string
  last?: boolean
  children: ReactNode
}) {
  return (
    <div
      className="ue:relative ue:flex ue:items-center ue:justify-end ue:border-t ue:border-line ue:px-3.5 ue:text-footnote ue:font-medium"
      style={{
        height: V.rowH,
        color: toneColor(tone),
        background: `color-mix(in oklab, ${toneColor(tone)} 5%, transparent)`,
        borderRadius: last ? `0 0 calc(${V.radius} - 1px) calc(${V.radius} - 1px)` : undefined,
      }}
    >
      {label}
      {children}
    </div>
  )
}

/**
 * 圆点引脚：骑在边框上，外面一圈卡片色和卡片隔开。没连线是空心圈，连上了填实；
 * 出口行里的圆点（tone 开着时）跟出口同色。拖线、Alt 断开这些行为由调用方经 props 给
 */
export function Pin({
  id,
  side,
  exit,
  linked,
  top,
  editable,
  title,
  onMouseDownCapture,
}: {
  id: string
  side: 'in' | 'out'
  /** 出口行里的引脚：跟出口同色（设置里能关）；头部的引脚一律灰 */
  exit?: boolean
  linked: boolean
  /** 不给时在所在行的竖直正中 */
  top?: number
  editable: boolean
  title?: string
  onMouseDownCapture?: (e: React.MouseEvent) => void
}) {
  const ink = exit ? V.pinTone : 'var(--subtle)'
  return (
    <Handle
      id={id}
      type={side === 'in' ? 'target' : 'source'}
      position={side === 'in' ? Position.Left : Position.Right}
      isConnectable={editable}
      title={title}
      onMouseDownCapture={onMouseDownCapture}
      className="gt-pin ue:!min-w-0 ue:!border-0"
      style={{
        width: V.pin,
        height: V.pin,
        borderRadius: 999,
        // 位置交给画布：骑在边框正中（xyflow 的 translate(±50%, -50%)），悬停放大也是画布统一的
        top: top ?? '50%',
        background: linked ? ink : 'var(--card)',
        boxShadow: `0 0 0 1.5px ${ink}, 0 0 0 ${V.ring} var(--card)`,
      }}
    />
  )
}
