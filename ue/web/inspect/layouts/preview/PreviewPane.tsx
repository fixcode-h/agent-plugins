import { ExternalLink, ImageOff, Loader2, MonitorOff, RefreshCw, RotateCcw, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { op, useAction } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { useLaunch } from '../../../launch.ts'
import { LaunchButton } from '../../../launch-progress/LaunchButton.tsx'
import { Card, ErrorText } from '../../../ui.tsx'
import { DEFAULT_VIEW, dolly, isDefaultView, orbit, reqSize, type PreviewView } from './model.ts'
import { useAssetPreview, type PreviewState } from './use-preview.ts'

/**
 * 资源预览区（效果图 B2–B6、B10 中间，蓝图视口 A1）：UE 用缩略图渲染画的一张图（asset.preview），不是网页自己画的。
 * - 能转视角的（网格、材质球、蓝图）：按住拖转 yaw / pitch，滚轮推拉距离，松手前也会节流着重新请求；
 * - UE 说不支持这类资源时把 UE 的原话写在中间，不画假画面；UE 没开给「启动编辑器」，桥接旧说明要更新 UELink。
 * tools 是工具条上多放的东西（贴图的通道），overlay 叠在图上（选中提示、统计），imgStyle 给贴图的通道滤镜和缩放用
 */
export function PreviewPane({
  path,
  title,
  icon: Icon,
  orbitable = true,
  select,
  tools,
  overlay,
  imgStyle,
  max = 1024,
  checker,
  className = 'ue:min-h-0 ue:flex-1',
}: {
  path: string
  title?: ReactNode
  icon?: LucideIcon
  /** 能拖动转视角（贴图不能） */
  orbitable?: boolean
  select?: string
  tools?: ReactNode
  overlay?: ReactNode
  imgStyle?: CSSProperties
  /** 请求的图最大边长（像素） */
  max?: number
  /** 图下面垫棋盘格（贴图） */
  checker?: boolean
  className?: string
}) {
  const { ui, cn } = h()
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 512, h: 512 })
  const [view, setView] = useState<{ path: string; v: PreviewView }>({ path, v: DEFAULT_VIEW })
  const v = view.path === path ? view.v : DEFAULT_VIEW
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  const p = useAssetPreview({
    path,
    width: reqSize(size.w, dpr, max),
    height: reqSize(size.h, dpr, max),
    // 没动过视角时不给：用资源自己的缩略图设置（和内容浏览器里看到的一样）
    ...(orbitable && !isDefaultView(v) ? { view: v } : {}),
    ...(select ? { select } : {}),
  })

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    // 滚轮推拉：React 的 onWheel 是被动监听，拦不住页面滚动，这里自己挂
    const wheel = (e: WheelEvent) => {
      if (!orbitable) return
      e.preventDefault()
      setView((s) => ({ path, v: dolly(s.path === path ? s.v : DEFAULT_VIEW, e.deltaY) }))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', wheel)
    }
  }, [path, orbitable])

  const drag = useRef<{ x: number; y: number }>(undefined)
  const canDrag = orbitable && p.state === 'ok'
  const reset = () => setView({ path, v: DEFAULT_VIEW })

  return (
    <Card
      className={className}
      title={
        <>
          {Icon && <Icon className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />}
          {title ?? t('预览')}
          {p.busy && <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin ue:text-subtle" aria-label={t('渲染中')} />}
        </>
      }
      aside={
        <>
          {tools}
          {orbitable && (
            <ui.IconButton
              icon={RotateCcw}
              size="sm"
              label={t('重置视角')}
              disabled={isDefaultView(v)}
              onClick={reset}
            />
          )}
          <ui.IconButton
            icon={RefreshCw}
            size="sm"
            label={t('重新渲染')}
            disabled={p.state !== 'ok'}
            onClick={p.refresh}
          />
        </>
      }
      bodyClass="ue:relative ue:flex ue:min-h-0 ue:flex-col ue:overflow-hidden ue:bg-panel"
    >
      <div
        ref={box}
        className={cn(
          'ue:relative ue:flex ue:min-h-0 ue:flex-1 ue:items-center ue:justify-center ue:select-none',
          canDrag && 'ue:cursor-grab ue:active:cursor-grabbing',
        )}
        style={checker ? CHECKER : undefined}
        onPointerDown={(e) => {
          if (!canDrag || e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          drag.current = { x: e.clientX, y: e.clientY }
          setView((s) => ({ path, v: orbit(s.path === path ? s.v : DEFAULT_VIEW, e.clientX - d.x, e.clientY - d.y) }))
        }}
        onPointerUp={() => (drag.current = undefined)}
        onDoubleClick={() => orbitable && reset()}
      >
        {p.shot ? (
          <img
            src={p.shot.url}
            alt={t('UE 渲染的预览图')}
            draggable={false}
            className="ue:max-h-full ue:max-w-full ue:object-contain"
            style={imgStyle}
          />
        ) : p.state !== 'ok' ? (
          <Missing state={p.state} path={path} />
        ) : p.error ? (
          // UE 画不了（类型不支持、还在编译……）：UE 的原话放在中间，不画假画面
          <div className="ue:flex ue:max-w-lg ue:flex-col ue:items-center ue:gap-3 ue:p-6 ue:text-center">
            <ImageOff className="ue:h-8 ue:w-8 ue:text-subtle" />
            <div className="ue:text-body ue:font-medium ue:text-fg">{t('UE 没画出预览')}</div>
            <ErrorText>{p.error}</ErrorText>
          </div>
        ) : (
          <span className="ue:text-footnote ue:text-subtle">{t('UE 渲染中…')}</span>
        )}
        {p.error && p.shot && (
          // 换视角后重画失败：旧图留着，原因浮在上面
          <div className="ue:absolute ue:inset-x-4 ue:top-4">
            <ErrorText>{p.error}</ErrorText>
          </div>
        )}
        {overlay}
      </div>
      {p.shot && (
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-x-3 ue:gap-y-0.5 ue:border-t ue:border-line ue:bg-card ue:px-3 ue:py-1 ue:font-mono ue:text-caption ue:text-subtle">
          <span>
            {t('UE 缩略图渲染 · {w}×{h} · {ms} ms', { w: p.shot.width, h: p.shot.height, ms: Math.round(p.shot.ms) })}
          </span>
          {orbitable && !isDefaultView(v) && (
            <span>
              yaw {v.yaw} · pitch {v.pitch} · {t('距离 {d}', { d: v.distance })}
            </span>
          )}
          {orbitable && <span className="ue:ml-auto">{t('拖动旋转 · 滚轮推拉 · 双击重置')}</span>}
          {p.shot.note && <span className="ue:basis-full ue:text-warning">{p.shot.note}</span>}
        </div>
      )}
    </Card>
  )
}

/** 贴图下面的棋盘格（看得出透明和图的边界）：主题里画布的棋盘格颜色 */
const CHECKER: CSSProperties = {
  backgroundImage:
    'conic-gradient(var(--canvas-checker) 25%, transparent 0 50%, var(--canvas-checker) 0 75%, transparent 0)',
  backgroundSize: '16px 16px',
}

/** 拿不到画面时的说明：UE 没开、或者 UELink 太旧没有 asset.preview（中间不画假画面） */
function Missing({ state, path }: { state: Exclude<PreviewState, 'ok'>; path: string }) {
  const { project } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const launch = useLaunch()
  return (
    <div className="ue:flex ue:max-w-md ue:flex-col ue:items-center ue:gap-3 ue:p-6 ue:text-center">
      <MonitorOff className="ue:h-8 ue:w-8 ue:text-subtle" />
      <div className="ue:text-body ue:font-medium ue:text-fg">
        {state === 'offline' ? t('预览要 UE 编辑器渲染') : t('UELink 太旧，没有资源预览')}
      </div>
      <p className="ue:text-footnote ue:text-subtle">
        {state === 'offline'
          ? t('UE 编辑器没开（或项目没装 UELink）：开了以后这里显示 UE 渲染的预览图，细节照常能看。')
          : t(
              '资源预览要 UELink 2.18 的 asset.preview：到 UE 页「UE 插件」更新 UELink、重新编译并重启 UE。细节照常能看，要看画面点「在 UE 里打开」。',
            )}
      </p>
      {state === 'offline' ? (
        <LaunchButton
          size="sm"
          progress={launch.progress}
          disabled={launch.busy}
          onClick={() => void launch.start(false)}
        >
          {t('启动编辑器')}
        </LaunchButton>
      ) : (
        <ui.Button
          size="sm"
          variant="secondary"
          disabled={!!busy}
          onClick={() => void run('open', () => op(project.id, 'asset.open', { path }, { instance: 'editor' }))}
        >
          <ExternalLink className="ue:h-3.5 ue:w-3.5" /> {t('在 UE 里打开')}
        </ui.Button>
      )}
    </div>
  )
}
