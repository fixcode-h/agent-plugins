import { Crosshair, LayoutDashboard, Loader2, RefreshCw, TriangleAlert, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { useKept } from '../../../keep.ts'
import { sampleAnim, type Anim } from '../../../timeline/keys.ts'
import { Badge } from '../../../ui.tsx'
import { hitTest, layoutTree, withSlotAnims, type Rect } from './approx.ts'
import { ApproxCanvas } from './ApproxCanvas.tsx'
import { indexTree, resolveTarget, type WNode } from './model.ts'
import { SCREENS, ZOOMS, type Screen, type Zoom } from './screens.ts'
import { useUmgRender } from './use-render.ts'

/**
 * 设计器（设计稿第 4 节、效果图 U1 / U4）：中间的预览台。
 * - 桥接有 umg.render：UE 离屏渲染的截图 + UE 回的控件矩形；拖播放头时按动画时刻重渲（use-render.ts 只留最新一次）。
 * - 没有：按控件树和属性在网页里画近似预览（approx.ts），页头标「近似预览」。
 * 两种都按矩形画布局框、悬停框、选中框和尺寸标签；点预览选控件（矩形命中取最小的），和左边的控件树双向联动。
 */
export function Designer({
  path,
  tree,
  live,
  selected,
  onSelect,
  anim,
  time,
}: {
  path: string
  tree?: WNode
  /** 能让 UE 实时渲染 */
  live: boolean
  selected?: string
  onSelect: (key: string) => void
  anim?: Anim
  time: number
}) {
  const { project } = useUe()
  const { ui, cn } = h()
  const [screen, setScreen] = useKept<Screen>(`${project.id}/umg/screen`, { id: '1920x1080', w: 1920, h: 1080 })
  const [zoom, setZoom] = useKept<Zoom>(`${project.id}/umg/zoom`, 'fit')
  const [boxes, setBoxes] = useKept(`${project.id}/umg/boxes`, true)
  const [hover, setHover] = useState<string>()
  const stage = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState({ w: 800, h: 450 })
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setRoom({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 播放头的时刻量化到帧（60fps），拖动时少发重复的渲染请求
  const frameTime = Math.round(time * 60) / 60
  const render = useUmgRender(
    { path, width: screen.w, height: screen.h, ...(anim ? { anim: anim.name, time: frameTime } : {}) },
    live,
  )
  const idx = useMemo(() => indexTree(tree), [tree])
  const values = useMemo(() => {
    // 动画轨道的 target 可能是完整路径也可能只有控件名：都换成树上的 key
    const out = new Map<string, Record<string, unknown>>()
    for (const [target, v] of sampleAnim(anim, time)) {
      const n = resolveTarget(idx, target)
      if (n) out.set(n.key, { ...out.get(n.key), ...v })
    }
    return out
  }, [anim, time, idx])
  const approx = !render.shot
  const shown = useMemo(() => (tree && approx ? withSlotAnims(tree, values) : tree), [tree, approx, values])
  const rects: Rect[] = useMemo(() => {
    if (render.shot)
      return render.shot.widgets.flatMap((w) => {
        const n = resolveTarget(idx, w.name)
        return n ? [{ key: n.key, x: w.x, y: w.y, w: w.w, h: w.h }] : []
      })
    return shown ? layoutTree(shown, screen.w, screen.h) : []
  }, [render.shot, shown, idx, screen.w, screen.h])
  const rectMap = useMemo(() => new Map(rects.map((r) => [r.key, r])), [rects])

  const fit = Math.max(0.05, Math.min((room.w - 48) / screen.w, (room.h - 56) / screen.h))
  const k = zoom === 'fit' ? fit : Number(zoom)
  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return hitTest(rects, (e.clientX - r.left) / k, (e.clientY - r.top) / k)?.key
  }
  const sel = selected ? rectMap.get(selected) : undefined
  const hov = hover && hover !== selected ? rectMap.get(hover) : undefined
  const preset = SCREENS().find((s) => s.id === screen.id) ? screen.id : 'custom'

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:bg-card">
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1.5 ue:border-b ue:border-line ue:px-3 ue:py-1.5">
        <ui.Select
          size="sm"
          aria-label={t('屏幕尺寸')}
          title={t('屏幕尺寸（照 UE 设计器的预设）')}
          className="ue:w-48"
          value={preset}
          onChange={(e: { target: { value: string } }) => {
            const s = SCREENS().find((x) => x.id === e.target.value)
            setScreen(s ? { id: s.id, w: s.w, h: s.h } : { ...screen, id: 'custom' })
          }}
          options={[
            ...SCREENS().map((s) => ({ value: s.id, label: `${s.w} × ${s.h} · ${s.label}` })),
            { value: 'custom', label: t('自定义…') },
          ]}
        />
        {preset === 'custom' && (
          <span className="ue:flex ue:items-center ue:gap-1 ue:text-footnote ue:text-subtle">
            {(['w', 'h'] as const).map((d) => (
              <ui.Input
                key={d}
                size="sm"
                type="number"
                className="ue:w-20"
                aria-label={d === 'w' ? t('宽') : t('高')}
                value={String(screen[d])}
                onChange={(e: { target: { value: string } }) => {
                  const n = Math.max(64, Math.min(8192, Math.round(Number(e.target.value) || 0)))
                  setScreen({ ...screen, id: 'custom', [d]: n })
                }}
              />
            ))}
          </span>
        )}
        <ui.Select
          size="sm"
          aria-label={t('缩放')}
          className="ue:w-24"
          value={zoom}
          onChange={(e: { target: { value: string } }) => setZoom(e.target.value as Zoom)}
          options={ZOOMS.map((z) => ({ value: z, label: z === 'fit' ? t('适应') : `${Number(z) * 100}%` }))}
        />
        <ui.IconButton
          icon={LayoutDashboard}
          label={boxes ? t('隐藏布局框') : t('显示布局框')}
          size="sm"
          aria-pressed={boxes}
          className={cn(boxes && 'ue:bg-active ue:text-fg')}
          onClick={() => setBoxes(!boxes)}
        />
        <span className="ue:ml-auto ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
          {render.error && (
            <span className="ue:min-w-0 ue:truncate ue:text-footnote ue:text-danger" title={render.error}>
              {render.error}
            </span>
          )}
          {render.shot?.note && (
            // UE 渲染时的提醒（有没编译的改动、这段动画不支持按时刻求值…）：直接写出来，不藏在悬停里
            <span className="ue:min-w-0 ue:truncate ue:text-footnote ue:text-warning" title={render.shot.note}>
              {render.shot.note}
            </span>
          )}
          {render.shot ? (
            <Badge tone="ok">
              <Zap className="ue:mr-0.5 ue:inline ue:h-3 ue:w-3" />
              {t('UE 实时渲染 · {s} 秒', { s: (render.shot.ms / 1000).toFixed(1) })}
            </Badge>
          ) : (
            <Badge
              tone="warn"
              title={t(
                'UE 没开、UELink 版本旧或资源还没导入：按控件树和 Slot / Brush / Text 属性在网页里画，字体和材质画不出来',
              )}
            >
              <TriangleAlert className="ue:mr-0.5 ue:inline ue:h-3 ue:w-3" />
              {t('近似预览 · 网页里按属性画')}
            </Badge>
          )}
          {live && (
            <ui.IconButton
              icon={render.busy ? Loader2 : RefreshCw}
              label={t('重新渲染')}
              size="sm"
              disabled={render.busy}
              className={cn(render.busy && 'ue:animate-spin')}
              onClick={render.refresh}
            />
          )}
        </span>
      </div>
      <div ref={stage} className="ue:relative ue:min-h-0 ue:flex-1 ue:overflow-auto ue:bg-canvas">
        {!tree ? (
          <p className="ue:p-6 ue:text-center ue:text-footnote ue:text-canvas-subtle">
            {t('没有控件树：UE 没开或 UELink 版本旧，又没有 AssetForge 配置可以照着画')}
          </p>
        ) : (
          <div
            className="ue:flex ue:min-h-full ue:min-w-full ue:items-center ue:justify-center ue:p-6"
            style={{ width: 'max-content' }}
          >
            <div className="ue:flex ue:flex-col ue:gap-1">
              <div
                className="ue:relative ue:cursor-crosshair ue:overflow-hidden ue:shadow-canvas ue:outline ue:outline-canvas-line"
                style={{ width: screen.w * k, height: screen.h * k }}
                onPointerMove={(e) => setHover(pick(e))}
                onPointerLeave={() => setHover(undefined)}
                onClick={(e) => {
                  const key = pick(e as unknown as PointerEvent<HTMLDivElement>)
                  if (key) onSelect(key)
                }}
              >
                {render.shot ? (
                  <img
                    src={render.shot.url}
                    alt={t('UE 渲染的预览')}
                    draggable={false}
                    className="ue:absolute ue:inset-0 ue:h-full ue:w-full ue:select-none"
                  />
                ) : (
                  <div
                    className="ue:absolute ue:top-0 ue:left-0 ue:origin-top-left ue:bg-canvas-board"
                    style={{ width: screen.w, height: screen.h, transform: `scale(${k})` }}
                  >
                    {shown && <ApproxCanvas tree={shown} rects={rectMap} anims={values} />}
                  </div>
                )}
                {boxes &&
                  rects.map((r) => (
                    <span
                      key={r.key}
                      className="ue:pointer-events-none ue:absolute ue:border ue:border-dashed ue:border-canvas-guide/50"
                      style={{ left: r.x * k, top: r.y * k, width: r.w * k, height: r.h * k }}
                    />
                  ))}
                {hov && (
                  <span
                    className="ue:pointer-events-none ue:absolute ue:border ue:border-accent/70 ue:bg-accent/8"
                    style={{ left: hov.x * k, top: hov.y * k, width: hov.w * k, height: hov.h * k }}
                  />
                )}
                {sel && (
                  <span
                    className="ue:pointer-events-none ue:absolute ue:border-2 ue:border-accent"
                    style={{ left: sel.x * k - 1, top: sel.y * k - 1, width: sel.w * k + 2, height: sel.h * k + 2 }}
                  >
                    <span className="ue:absolute ue:-top-5 ue:left-[-2px] ue:rounded-t-[3px] ue:bg-accent ue:px-1.5 ue:font-mono ue:text-caption ue:whitespace-nowrap ue:text-on-accent">
                      {idx.byKey.get(sel.key)?.name} · {Math.round(sel.w)}×{Math.round(sel.h)}
                    </span>
                  </span>
                )}
              </div>
              <span className="ue:flex ue:items-center ue:gap-1.5 ue:font-mono ue:text-caption ue:text-canvas-subtle">
                <Crosshair className="ue:h-3 ue:w-3" />
                {t('{w} × {h} · 缩放 {k}%', { w: screen.w, h: screen.h, k: Math.round(k * 100) })}
                {' · '}
                {t('点预览选控件，悬停高亮')}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
