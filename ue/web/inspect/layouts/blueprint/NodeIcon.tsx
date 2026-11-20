import type { NodeIcon } from './ue-style.ts'

/**
 * 标题条左边的小图标，照 UE 的样子画（白色线条）：事件是菱形、函数是 f、流程控制是分叉箭头、
 * 宏是两道折线、Cast 是 f 加箭头。用自画的 SVG 而不是通用图标库，形状才贴近 UE
 */
export function NodeIconGlyph({ icon, color = '#ffffff' }: { icon: NodeIcon; color?: string }) {
  if (icon === 'none') return null
  const common = { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true, className: 'ue:shrink-0' }
  switch (icon) {
    case 'event':
      return (
        <svg {...common}>
          <path
            d="M7 1.2 L12.8 7 L7 12.8 L1.2 7 Z"
            fill="none"
            stroke={color}
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M7 4.4 L9.6 7 L7 9.6 L4.4 7 Z" fill={color} />
        </svg>
      )
    case 'flow':
      return (
        <svg {...common}>
          <path
            d="M1.5 7 H5.5 M5.5 7 L9 3 H12 M5.5 7 L9 11 H12"
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'macro':
      return (
        <svg {...common}>
          <path
            d="M2 4 L5 7 L2 10 M7 4 L10 7 L7 10"
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'cast':
      return (
        <svg {...common}>
          <text x="1" y="11" fontSize="11" fontStyle="italic" fontWeight="700" fontFamily="Georgia, serif" fill={color}>
            f
          </text>
          <path
            d="M7 7 H12.5 M10.5 5 L12.5 7 L10.5 9"
            fill="none"
            stroke={color}
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    default:
      // function / entry：UE 的函数图标是斜体 f
      return (
        <svg {...common}>
          <text
            x="3.5"
            y="11.5"
            fontSize="12.5"
            fontStyle="italic"
            fontWeight="700"
            fontFamily="Georgia, serif"
            fill={color}
          >
            f
          </text>
        </svg>
      )
  }
}
