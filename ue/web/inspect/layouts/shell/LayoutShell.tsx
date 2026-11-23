import { useRef, useState, type ReactNode } from 'react'
import { h } from '../../../host.ts'
import { PANE_FILL, PANE_FILL_H, PANE_FIXED, PANE_FIXED_H, SPLIT_ROW, SplitHandle } from '@panel/web/src/components/ui/split-pane'
import type { LayoutDef, RegionDef } from '../types.ts'
import { regionOff, useRegion } from './regions.ts'

type Place = RegionDef['place']

/** 没声明某个位置时给 useRegion 的占位（hooks 要无条件调用；占位的尺寸不会显示也不会存） */
const NONE = (place: Place): RegionDef => ({ id: `_${place}`, label: () => '', place, size: '0px', min: 0 })

/**
 * 区域积木（设计稿第 2 节）：按布局声明的区域摆出左 / 左下 / 中 / 底 / 右几块，块之间是可拖的细线（面板 split-pane），
 * 尺寸按「布局 id + 区域」记在本机、双击恢复默认；窄屏（lg 以下）上下排、整块滚。
 * regions 按区域 id 给内容；某块没给内容（null）或在设置里关掉了（optional 的区域）就不画，旁边的块占满。
 * 每块自己画标题和内容（一般是 Card），这里只管摆和拖。
 */
export function LayoutShell({
  layout,
  head,
  center,
  regions,
}: {
  layout: LayoutDef
  /** 整个布局上面的一行（资源页头：名字、视图切换、通用按钮） */
  head?: ReactNode
  center: ReactNode
  regions: Record<string, ReactNode>
}) {
  const { cn } = h()
  const of = (place: Place) => layout.regions.find((r) => r.place === place)
  const defs = { left: of('left'), leftBottom: of('leftBottom'), right: of('right'), bottom: of('bottom') }
  const left = useRegion(layout.id, defs.left ?? NONE('left'))
  const leftBottom = useRegion(layout.id, defs.leftBottom ?? NONE('leftBottom'))
  const right = useRegion(layout.id, defs.right ?? NONE('right'))
  const bottom = useRegion(layout.id, defs.bottom ?? NONE('bottom'))
  // 设置里关掉的区域：挂载时读一次（设置在别的页面改，回来重新挂载）
  const [off] = useState(
    () => new Set(layout.regions.filter((r) => r.optional && regionOff(layout.id, r.id)).map((r) => r.id)),
  )
  const content = (r?: RegionDef) => (r && !off.has(r.id) ? (regions[r.id] ?? null) : null)
  const body = {
    left: content(defs.left),
    leftBottom: content(defs.leftBottom),
    right: content(defs.right),
    bottom: content(defs.bottom),
  }
  const refs = {
    left: useRef<HTMLDivElement>(null),
    leftBottom: useRef<HTMLDivElement>(null),
    right: useRef<HTMLDivElement>(null),
    bottom: useRef<HTMLDivElement>(null),
  }
  const hasLeft = !!(body.left || body.leftBottom)
  // 左右栏的上限：中间至少留这么宽（设计器、表格要地方）
  const reserveLeft = () => 360 + (body.right ? (refs.right.current?.offsetWidth ?? 0) : 0)
  const reserveRight = () => 360 + (hasLeft ? (refs.left.current?.offsetWidth ?? 0) : 0)

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      {head}
      <div className={SPLIT_ROW}>
        {hasLeft && (
          <>
            <div
              ref={refs.left}
              className={cn(PANE_FIXED, 'ue:flex ue:min-h-0 ue:flex-col ue:divide-y ue:divide-line ue:lg:divide-y-0')}
              style={left.style(body.right ? 'calc(100% - 720px)' : 'calc(100% - 360px)')}
            >
              {body.left && (
                <div className={cn(PANE_FILL_H, 'ue:flex ue:min-h-64 ue:flex-col ue:lg:min-h-0')}>{body.left}</div>
              )}
              {body.left && body.leftBottom && (
                <SplitHandle pane={leftBottom} paneRef={refs.leftBottom} side="right" reserve={() => 120} />
              )}
              {body.leftBottom && (
                <div
                  ref={refs.leftBottom}
                  className={cn(body.left ? PANE_FIXED_H : PANE_FILL_H, 'ue:flex ue:flex-col')}
                  style={leftBottom.style('calc(100% - 120px)')}
                >
                  {body.leftBottom}
                </div>
              )}
            </div>
            <SplitHandle pane={left} paneRef={refs.left} reserve={reserveLeft} />
          </>
        )}
        <div className={cn(PANE_FILL, 'ue:flex ue:min-h-0 ue:flex-col ue:divide-y ue:divide-line ue:lg:divide-y-0')}>
          <div className={cn(PANE_FILL_H, 'ue:flex ue:min-h-80 ue:flex-col ue:lg:min-h-0')}>{center}</div>
          {body.bottom && (
            <>
              <SplitHandle pane={bottom} paneRef={refs.bottom} side="right" reserve={() => 160} />
              <div
                ref={refs.bottom}
                className={cn(PANE_FIXED_H, 'ue:flex ue:flex-col')}
                style={bottom.style('calc(100% - 160px)')}
              >
                {body.bottom}
              </div>
            </>
          )}
        </div>
        {body.right && (
          <>
            <SplitHandle pane={right} paneRef={refs.right} side="right" reserve={reserveRight} />
            <div
              ref={refs.right}
              className={cn(PANE_FIXED, 'ue:flex ue:min-h-0 ue:flex-col')}
              style={right.style(hasLeft ? 'calc(100% - 720px)' : 'calc(100% - 360px)')}
            >
              {body.right}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
