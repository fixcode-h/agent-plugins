import { useEffect, useRef, useState } from 'react'
import { op } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { h } from '../../../host.ts'
import { useTargetInfo } from '../../../ui.tsx'
import { hasCap, oldBridge, waitFor, type PreviewShot, type PreviewView } from './model.ts'

export interface PreviewReq {
  path: string
  width: number
  height: number
  /** 贴图没有视角：不给 */
  view?: PreviewView
  /** 蓝图视口里选中的组件名（缩略图模式下 UE 只在 note 里说明没生效） */
  select?: string
}

export type PreviewState =
  /** UE 没开：给「启动编辑器」 */
  | 'offline'
  /** 编辑器开着，但 UELink 没有 asset.preview（旧桥接）：说明要升级 */
  | 'old'
  | 'ok'

/**
 * 让 UE 把资源画成一张图（asset.preview，UELink 2.18，只在编辑器进程里有）。
 * 图是 <项目>/Saved/UELink/preview/ 下的 PNG，经服务端的只读路由 ext/file 取（和 umg.render 同一条路），地址带序号防缓存。
 * 拖视角时参数变得很快：同一时间只发一个请求，上一次发出后至少隔 120 毫秒；回来后参数又变了再发最新的一次，中间的都跳过。
 * UE 说不支持这类资源（Niagara、音频、动画序列……）时 error 是 UE 的原话，界面原样显示，不画假画面
 */
export function useAssetPreview(req: PreviewReq, enabled = true) {
  const { project } = useUe()
  const { list } = useTargetInfo()
  // 编辑器专用的操作：不管当前目标是哪个进程，都问编辑器
  const editor = list.find((i) => i.kind === 'editor')
  const can = hasCap(editor, 'asset.preview')
  const [shot, setShot] = useState<PreviewShot & { url: string; for: string }>()
  const [error, setError] = useState<{ for: string; msg: string }>()
  const [gone, setGone] = useState(false)
  const [busy, setBusy] = useState(false)
  const want = useRef(req)
  want.current = req
  const flight = useRef(false)
  const again = useRef(false)
  const lastAt = useRef(0)
  const seq = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const sig = JSON.stringify(req)
  const on = enabled && can && !gone

  const fire = async () => {
    if (flight.current) {
      again.current = true
      return
    }
    const wait = waitFor(lastAt.current, Date.now())
    if (wait > 0) {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void fire(), wait)
      return
    }
    flight.current = true
    lastAt.current = Date.now()
    setBusy(true)
    const r = want.current
    try {
      const res = await op<PreviewShot>(
        project.id,
        'asset.preview',
        {
          path: r.path,
          width: r.width,
          height: r.height,
          ...(r.view ? { view: r.view } : {}),
          ...(r.select ? { select: r.select } : {}),
        },
        { instance: 'editor' },
        30000,
      )
      const url = h().api.url(
        `/p/${encodeURIComponent(project.id)}/ext/file?path=${encodeURIComponent(res.file)}&v=${++seq.current}`,
      )
      setShot({ ...res, url, for: r.path })
      setError(undefined)
    } catch (e) {
      const msg = (e as Error).message
      if (oldBridge(msg, 'asset.preview')) setGone(true)
      else setError({ for: r.path, msg })
    } finally {
      flight.current = false
      setBusy(false)
      if (again.current) {
        again.current = false
        void fire()
      }
    }
  }

  useEffect(() => {
    if (on) void fire()
    // 参数变了才重发（sig 是参数的指纹）；fire 每次渲染都是新函数
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, on])
  useEffect(() => () => clearTimeout(timer.current), [])

  const state: PreviewState = !editor?.online ? 'offline' : !can || gone ? 'old' : 'ok'
  return {
    state,
    // 切资源后旧图、旧错误不拿来用
    shot: on && shot?.for === req.path ? shot : undefined,
    error: on && error?.for === req.path ? error.msg : '',
    busy,
    refresh: () => void fire(),
  }
}
