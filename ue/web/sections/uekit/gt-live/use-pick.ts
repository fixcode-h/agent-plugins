import { useEffect, useState } from 'react'
import { op } from '../../../api.ts'
import { h } from '../../../host.ts'
import { useExtEvents } from '../ListCol.tsx'
import { isUnsupported } from './use-watch.ts'

/** 抓到的东西（gt.pick action=at 的返回 / gt.pick picked 事件，GameTest 1.10.0） */
export interface Picked {
  target?: string
  verified?: boolean
  targetError?: string
  widgetClass?: string
  /** 一键分路按它给分法 */
  kind?: 'button' | 'check' | 'text' | 'other'
  /** 控件在视口里的归一化 [x, y, w, h]：画面上画框 */
  rect?: number[]
  /** 控件所在界面的选择器和类：列「所在界面的变量」 */
  screen?: string
  screenClass?: string
  /** 点到的地方没有界面：射线打到的 Actor */
  actor?: { class: string; name: string; label?: string; nativeClass?: string }
  via?: 'game' | 'panel'
  error?: string
}

export interface Frame {
  jpg: string
  width: number
  height: number
}

const RENEW_MS = 20000

/** 抓取画面的参数：UE 插件设置「GameTest 编写」一组 */
function frameArgs() {
  const c = h().config()
  const num = (v: unknown, d: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d
  return {
    frames: c.gtLiveFrames !== false,
    fps: num(c.gtLiveFps, 2, 0.5, 10),
    maxWidth: Math.round(num(c.gtLiveWidth, 640, 160, 1920)),
    quality: Math.round(num(c.gtLiveQuality, 70, 30, 95)),
  }
}

/**
 * 从游戏里抓（定稿 9.3）：开着时向 GameTest 开一个抓取会话（gt.pick start），收 gt.pick 推送——
 * 画面（frame）和游戏里 Ctrl+Alt 点到的东西（picked）；面板画面上点一下走 pickAt。会话是租约，关掉弹窗就停
 */
export function usePick(project: string, on: boolean) {
  const [frame, setFrame] = useState<Frame>()
  const [picked, setPicked] = useState<Picked>()
  const [error, setError] = useState('')
  const [unsupported, setUnsupported] = useState(false)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!on) return
    let off = false
    const start = (withFrame: boolean) =>
      op<{ frame?: Frame; frameError?: string; recording?: boolean }>(project, 'gt.pick', {
        action: 'start',
        withFrame,
        ttlMs: 60000,
        ...frameArgs(),
      })
        .then((r) => {
          if (off) return
          setError(r.frameError ?? '')
          setRecording(!!r.recording)
          if (r.frame) setFrame(r.frame)
        })
        .catch((e: Error) => {
          if (off) return
          setUnsupported(isUnsupported(e.message, 'gt.pick'))
          setError(e.message)
        })
    void start(true)
    // 续租：只告诉 UE 还有人在看，画面和点到的东西都靠推送
    const renew = setInterval(() => void start(false), RENEW_MS)
    return () => {
      off = true
      clearInterval(renew)
      void op(project, 'gt.pick', { action: 'stop' }).catch(() => undefined)
    }
  }, [project, on])

  useExtEvents(project, (e) => {
    if (!on || e.event !== 'gt.pick') return
    if (e.kind === 'frame' && typeof e.jpg === 'string')
      setFrame({ jpg: e.jpg, width: Number(e.width), height: Number(e.height) })
    else if (e.kind === 'picked') {
      const p = e as unknown as Picked
      if (p.error) h().toast.error(p.error)
      else setPicked(p)
    }
  })

  const pickAt = async (x: number, y: number) => {
    setBusy(true)
    try {
      setPicked(await op<Picked>(project, 'gt.pick', { action: 'at', x, y }))
    } catch (e) {
      h().toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return { frame, picked, setPicked, error, unsupported, recording, busy, pickAt }
}
