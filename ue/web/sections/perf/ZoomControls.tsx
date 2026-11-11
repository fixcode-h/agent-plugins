import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { h, t } from '../../host.ts'
import type { Range } from './trace.ts'
import { clampWin, isWhole, minSpan, zoomAround } from './zoom.ts'

/**
 * 横向图的缩放按钮组和底部滚动条（帧条用；别的横向图要缩放时直接拿去用）。
 * 按钮：缩小 / 放大（以窗口中心为准）/ 看整段，旁边标当前倍数；滚动条：缩放后才出现，拖滑块左右平移，点轨道跳过去。
 */
export function ZoomControls({ win, duration, onWin }: { win: Range; duration: number; onWin: (r: Range) => void }) {
  const whole = isWhole(win, duration)
  const mid = (win.t0 + win.t1) / 2
  const k = duration / Math.max(win.t1 - win.t0, 1e-12)
  return (
    <span className="ue:inline-flex ue:items-center ue:gap-0.5">
      {!whole && (
        <span className="ue:mr-1 ue:font-mono ue:text-caption ue:text-subtle" title={t('帧条放大倍数')}>
          ×{k >= 100 ? k.toFixed(0) : k.toFixed(1)}
        </span>
      )}
      <ZoomBtn title={t('缩小（滚轮向下）')} disabled={whole} onClick={() => onWin(zoomAround(win, mid, 2, duration))}>
        <ZoomOut className="ue:h-3.5 ue:w-3.5" />
      </ZoomBtn>
      <ZoomBtn
        title={t('放大（滚轮向上）')}
        disabled={win.t1 - win.t0 <= minSpan(duration) * 1.001}
        onClick={() => onWin(zoomAround(win, mid, 0.5, duration))}
      >
        <ZoomIn className="ue:h-3.5 ue:w-3.5" />
      </ZoomBtn>
      <ZoomBtn title={t('帧条看整段')} disabled={whole} onClick={() => onWin({ t0: 0, t1: duration })}>
        <Maximize2 className="ue:h-3 ue:w-3" />
      </ZoomBtn>
    </span>
  )
}

function ZoomBtn({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={h().cn(
        'ue:inline-flex ue:h-6 ue:w-6 ue:cursor-pointer ue:items-center ue:justify-center ue:rounded-md ue:text-muted ue:transition-colors',
        'ue:hover:bg-hover ue:hover:text-fg ue:disabled:cursor-default ue:disabled:opacity-40 ue:disabled:hover:bg-transparent',
      )}
    >
      {children}
    </button>
  )
}

/** 缩放后的位置条：整条轨道 = 整段，滑块 = 当前看的窗口；没缩放时只留一条细线占位，高度不跳 */
export function WinScrollbar({ win, duration, onWin }: { win: Range; duration: number; onWin: (r: Range) => void }) {
  const track = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; win: Range } | null>(null)
  const whole = isWhole(win, duration)
  const d = Math.max(duration, 1e-9)
  const left = (win.t0 / d) * 100
  const width = Math.max(((win.t1 - win.t0) / d) * 100, 2)
  const px = () => Math.max(track.current?.clientWidth ?? 1, 1)
  return (
    <div
      ref={track}
      className={h().cn('ue:relative ue:mt-1 ue:h-1.5 ue:rounded-full', whole ? 'ue:bg-transparent' : 'ue:bg-hover')}
      onPointerDown={(e) => {
        if (whole || e.button !== 0) return
        // 点轨道空白处：窗口中心跳到那里
        const r = e.currentTarget.getBoundingClientRect()
        const at = ((e.clientX - r.left) / px()) * d
        const s = win.t1 - win.t0
        onWin(clampWin(at - s / 2, at + s / 2, duration))
      }}
    >
      {!whole && (
        <div
          className="ue:absolute ue:inset-y-0 ue:cursor-grab ue:rounded-full ue:bg-line-strong ue:transition-colors ue:hover:bg-accent/70 ue:active:cursor-grabbing"
          style={{ left: `${left}%`, width: `${width}%` }}
          title={t('拖动左右平移')}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { x: e.clientX, win }
          }}
          onPointerMove={(e) => {
            const g = drag.current
            if (!g) return
            const dt = ((e.clientX - g.x) / px()) * d
            onWin(clampWin(g.win.t0 + dt, g.win.t1 + dt, duration))
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        />
      )}
    </div>
  )
}
