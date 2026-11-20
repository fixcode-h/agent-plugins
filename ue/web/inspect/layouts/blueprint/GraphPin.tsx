import { Handle, Position } from '@xyflow/react'
import type { CSSProperties } from 'react'
import { h, t } from '../../../host.ts'
import type { GPin } from './graph.ts'
import { defaultText, pinColor, pinContainer, pinKind, pinLabel } from './ue-style.ts'
import { UE_CANVAS } from './ue-theme.ts'

/**
 * 蓝图节点上的引脚，照 UE 的图标：执行引脚是白色五边形箭头，数据引脚是类型色的圆，数组是小方格，
 * 委托是方块；连上了实心、没连空心。图标本身就是 xyflow 的 Handle（排在行里，不贴在节点边上），
 * 连线从输入图标的左边进、输出图标的右边出，和 UE 一样
 */
function PinIcon({ pin, linked }: { pin: GPin; linked: boolean }) {
  const ink = pinColor(pin.type)
  const fill = linked ? ink : 'none'
  if (pin.type === 'exec')
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <path
          d="M1.5 1.5 H6.5 L10.5 6 L6.5 10.5 H1.5 Z"
          fill={fill}
          stroke={ink}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    )
  const box = pinContainer(pin.type)
  if (box) {
    // 3×3 的小方格（UE 的数组图标）；没连线时格子淡一点
    const cells = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => [c, r]))
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden opacity={linked ? 1 : 0.7}>
        {cells.map(([c, r]) => (
          <rect key={`${c}${r}`} x={c * 4 + 0.5} y={r * 4 + 0.5} width="3" height="3" fill={ink} />
        ))}
      </svg>
    )
  }
  if (pinKind(pin.type) === 'delegate')
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <rect x="2" y="2" width="8" height="8" rx="1" fill={fill} stroke={ink} strokeWidth="1.5" />
      </svg>
    )
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <circle cx="6" cy="6" r="4.2" fill={fill} stroke={ink} strokeWidth="1.5" />
    </svg>
  )
}

/** Handle 排进行里：盖掉 xyflow 和面板给 Handle 的绝对定位、底色、描边和「只读时藏起来」 */
const HANDLE_STYLE: CSSProperties = {
  position: 'relative',
  inset: 'auto',
  transform: 'none',
  width: 12,
  height: 12,
  minWidth: 0,
  minHeight: 0,
  flexShrink: 0,
  display: 'flex',
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
  opacity: 1,
}

/** 输入引脚没连线时的默认值框；bool 画成 UE 那样的勾选框 */
function DefaultBox({ pin }: { pin: GPin }) {
  if (pinKind(pin.type) === 'bool' && /^(true|false)$/i.test(pin.default ?? '')) {
    const on = /^true$/i.test(pin.default!)
    return (
      <span
        className="ue:inline-flex ue:h-3 ue:w-3 ue:shrink-0 ue:items-center ue:justify-center ue:rounded-[2px] ue:text-[9px] ue:leading-none"
        style={{
          background: UE_CANVAS.field,
          boxShadow: `inset 0 0 0 1px ${UE_CANVAS.fieldBorder}`,
          color: UE_CANVAS.fieldText,
        }}
      >
        {on ? '✓' : ''}
      </span>
    )
  }
  return (
    <span
      className="ue:max-w-20 ue:shrink-0 ue:truncate ue:rounded-[3px] ue:px-1 ue:text-[10px] ue:leading-[14px]"
      style={{
        background: UE_CANVAS.field,
        boxShadow: `inset 0 0 0 1px ${UE_CANVAS.fieldBorder}`,
        color: UE_CANVAS.fieldText,
      }}
    >
      {defaultText(pin.default!)}
    </span>
  )
}

/**
 * 一行里一侧的引脚：输入是「图标 名字 默认值」靠左，输出是「名字 图标」靠右。
 * 两侧按内容伸缩（flex-auto）：flex-1 会各占一半，宽度够时长名字也被截断
 * hideName：变量 Get 节点的名字写在节点上，引脚不再写
 */
export function PinCell({ pin, side, hideName }: { pin?: GPin; side: 'in' | 'out'; hideName?: boolean }) {
  if (!pin) return <span className="ue:flex-auto" />
  const linked = !!pin.to?.length
  const label = hideName ? '' : (pinLabel(pin) ?? t('目标'))
  const icon = (
    <Handle
      id={`${side}:${pin.name}`}
      type={side === 'in' ? 'target' : 'source'}
      position={side === 'in' ? Position.Left : Position.Right}
      isConnectable={false}
      style={HANDLE_STYLE}
    >
      <PinIcon pin={pin} linked={linked} />
    </Handle>
  )
  return (
    <span
      className={h().cn(
        'ue:flex ue:min-w-0 ue:flex-auto ue:items-center ue:gap-1.5',
        side === 'out' && 'ue:justify-end',
      )}
      style={{ color: UE_CANVAS.pinText }}
      title={`${pin.name} · ${pin.type}${pin.default !== undefined ? ` = ${pin.default}` : ''}`}
    >
      {side === 'in' && icon}
      {label && <span className="ue:truncate">{label}</span>}
      {side === 'in' && pin.default !== undefined && !linked && <DefaultBox pin={pin} />}
      {side === 'out' && icon}
    </span>
  )
}
