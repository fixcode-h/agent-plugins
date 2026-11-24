import { useEffect, useRef, useState } from 'react'
import type { DiffFailed, DiffProgress } from '../../shared/asset-diff/progress.ts'
import type { AssetDiff } from '../../shared/asset-diff/types.ts'
import { ppost } from '../api.ts'
import { h, t } from '../host.ts'

/**
 * 版本差异的取数：点开一对版本才算（用户 2026-11-19），算过的这次打开里记着（左栏小标签从这里来）；
 * 读取中的分步进度经推送来（服务端 asset-diff/progress.ts），按请求号对上；能取消、能带「启动后台编辑器」重试
 */
export function useDiffRun(projectId: string, pkg: string, pair: { key: string; from: string | null; to: string } | null) {
  const done = useRef(new Map<string, AssetDiff>())
  const [, bump] = useState(0)
  const [since, setSince] = useState(0)
  // 出错的是哪一对：换到别的版本再回来时不残留
  const [failed, setFailed] = useState<{ key: string; failed: DiffFailed } | null>(null)
  const [progress, setProgress] = useState<DiffProgress | undefined>()
  const [nonce, setNonce] = useState(0)
  const req = useRef('')
  const bg = useRef(false)
  const { events } = h()

  events.useEvent('ue-asset-diff', (d) => {
    const p = d as DiffProgress
    if (p.req && p.req === req.current) setProgress(p)
  })

  const key = pair?.key ?? ''
  useEffect(() => {
    if (!pair || done.current.has(pair.key)) return
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    req.current = id
    setSince(Date.now())
    setFailed(null)
    setProgress(undefined)
    const startBackground = bg.current
    bg.current = false
    // 换了版本也让这一次算完：结果记下，点回来直接显示
    ppost<AssetDiff | { failed: DiffFailed }>(projectId, 'asset-diff', {
      path: pkg,
      from: pair.from,
      to: pair.to,
      req: id,
      conn: events.conn(),
      startBackground,
    }).then(
      (d) => {
        if ('failed' in d) {
          if (req.current === id) setFailed({ key: pair.key, failed: d.failed })
          return
        }
        done.current.set(pair.key, d)
        bump((n) => n + 1)
      },
      (e: Error) => {
        if (req.current === id) setFailed({ key: pair.key, failed: { kind: 'other', message: e.message } })
      },
    )
    // 按要比的两边和「重新读」变化重取
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, projectId, pkg])

  return {
    done: done.current,
    since,
    progress: progress?.req === req.current ? progress : undefined,
    failed: failed?.key === key ? failed.failed : undefined,
    /** 重新读这一对（改回旧值后、连上 UE 后、点「启动后台编辑器读」） */
    retry: (opts?: { startBackground?: boolean }) => {
      done.current.delete(key)
      bg.current = !!opts?.startBackground
      setNonce((n) => n + 1)
    },
    cancel: () => {
      const id = req.current
      req.current = ''
      void ppost(projectId, 'asset-diff/cancel', { req: id }).catch(() => undefined)
      setFailed({ key, failed: { kind: 'other', message: t('已取消') } })
    },
  }
}
