import { useEffect, useRef, useState } from 'react'
import { op } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { h } from '../../../host.ts'
import type { UmgRender } from './model.ts'
import { unsupported } from './use-umg.ts'

export interface RenderReq {
  path: string
  width: number
  height: number
  dpi?: number
  /** 动画名 + 时刻：UE 按这一刻求值动画再渲一帧（拖播放头） */
  anim?: string
  time?: number
}

/**
 * 让 UE 离屏渲染控件蓝图（umg.render）：图片是本机 Saved/UELink/preview/ 下的 PNG，网页经服务端已有的只读路由
 * ext/file（只认项目目录里的图片，GameTest 步骤截图也走它）取，地址带序号防缓存。
 * 拖播放头时参数变得很快：同一时间只发一个请求，回来后如果参数又变了再发最新的一次（中间的都跳过），UE 不会被请求堆住。
 */
export function useUmgRender(req: RenderReq, enabled: boolean) {
  const { project } = useUe()
  const [shot, setShot] = useState<UmgRender & { url: string }>()
  const [error, setError] = useState('')
  const [gone, setGone] = useState(false)
  const [busy, setBusy] = useState(false)
  const want = useRef(req)
  want.current = req
  const flight = useRef(false)
  const again = useRef(false)
  const seq = useRef(0)
  const sig = JSON.stringify(req)

  const fire = async () => {
    if (flight.current) {
      again.current = true
      return
    }
    flight.current = true
    setBusy(true)
    const r = want.current
    try {
      const res = await op<UmgRender>(
        project.id,
        'umg.render',
        {
          path: r.path,
          width: r.width,
          height: r.height,
          ...(r.dpi ? { dpi: r.dpi } : {}),
          ...(r.anim ? { anim: r.anim, time: r.time ?? 0 } : {}),
        },
        undefined,
        30000,
      )
      const url = h().api.url(
        `/p/${encodeURIComponent(project.id)}/ext/file?path=${encodeURIComponent(res.file)}&v=${++seq.current}`,
      )
      setShot({ ...res, url })
      setError('')
    } catch (e) {
      const msg = (e as Error).message
      // 名单里有、实际又不认识：当桥接旧，回到近似预览
      if (unsupported(msg)) setGone(true)
      else setError(msg)
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
    if (enabled && !gone) void fire()
    // 参数变了才重发（sig 是参数的指纹）；fire 每次渲染都是新函数
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, enabled, gone])

  return {
    shot: enabled && !gone ? shot : undefined,
    error,
    busy,
    supported: enabled && !gone,
    refresh: () => void fire(),
  }
}
