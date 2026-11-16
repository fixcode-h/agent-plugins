import { Gauge } from 'lucide-react'
import { useEffect, useState } from 'react'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Card, ErrorText, LinkBtn } from '../../ui.tsx'
import type { ProfResult } from './debug-types.ts'
import { ProfileTable } from './DebugViews.tsx'
import { useOpenLua } from './open-file.ts'

/**
 * Lua 性能采样（设计稿四.4）：采几秒，按函数聚合调用次数、自身和总用时，带文件和行号。
 * 采样时间是固定的，开始后按时长等一次再取结果（不是轮询）
 */
export function DebugProfile() {
  const { project, target } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const open = useOpenLua()
  const [seconds, setSeconds] = useState('5')
  const [res, setRes] = useState<ProfResult>()
  const [error, setError] = useState('')
  const [until, setUntil] = useState(0)
  const [n, tick] = useState(0)

  const fetchResult = async () => {
    try {
      const r = await op<ProfResult>(project.id, 'lua.profile', { action: 'result', limit: 200 }, target)
      setRes(r)
      setError('')
      if (r.running && r.remaining) setUntil(Date.now() + r.remaining * 1000)
      else setUntil(0)
    } catch (e) {
      setError((e as Error).message)
      setUntil(0)
    }
  }
  // 倒计时：每秒只动本地显示的剩余秒数，到了取一次结果（采样时长是固定的，不是轮询）
  useEffect(() => {
    if (!until) return
    const left = until - Date.now()
    if (left <= 0) {
      void fetchResult()
      return
    }
    const id = setTimeout(() => tick((x) => x + 1), Math.min(1000, left + 300))
    return () => clearTimeout(id)
    // fetchResult 每次渲染都是新函数；只跟着倒计时和每秒的刷新走
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [until, n])

  const start = () =>
    run('start', async () => {
      const s = Number(seconds)
      await op(project.id, 'lua.profile', { action: 'start', seconds: s }, target)
      setRes(undefined)
      setError('')
      setUntil(Date.now() + s * 1000)
    })
  const stop = () =>
    run('stop', async () => {
      await op(project.id, 'lua.profile', { action: 'stop' }, target)
      await fetchResult()
    })

  const left = until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0
  return (
    <Card
      title={
        <>
          <Gauge className="ue:h-4 ue:w-4 ue:text-subtle" /> {t('性能采样')}
        </>
      }
      aside={
        res?.report && (
          <LinkBtn onClick={() => void navigator.clipboard?.writeText(res.report!)}>{t('复制完整结果路径')}</LinkBtn>
        )
      }
      bodyClass="ue:flex ue:flex-col"
    >
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:p-3">
        <ui.Select
          size="sm"
          className="ue:w-32"
          value={seconds}
          onChange={(e: { target: { value: string } }) => setSeconds(e.target.value)}
          options={['3', '5', '10', '30'].map((n) => ({ value: n, label: t('采 {n} 秒', { n }) }))}
        />
        {until ? (
          <ui.Button size="sm" variant="secondary" disabled={busy === 'stop'} onClick={() => void stop()}>
            {t('提前结束（还剩 {n} 秒）', { n: left })}
          </ui.Button>
        ) : (
          <ui.Button size="sm" disabled={busy === 'start'} onClick={() => void start()}>
            {t('开始采样')}
          </ui.Button>
        )}
        {res && !res.running && (
          <span className="ue:text-caption ue:text-subtle">
            {t('{s} 秒 · {n} 个函数 · {e} 次调用事件', {
              s: (res.seconds ?? 0).toFixed(1),
              n: res.total ?? 0,
              e: (res.events ?? 0).toLocaleString(),
            })}
          </span>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      {!res && !until && !error && (
        <p className="ue:px-3 ue:py-3 ue:text-footnote ue:text-subtle">
          {t(
            '采样期间每次函数调用都记时间，游戏会慢一些；C 函数是 UnLua 导出的 UE 接口，自身用时里含它在引擎里花的时间',
          )}
        </p>
      )}
      {!!res?.items?.length && (
        <div className="ue:max-h-[420px] ue:overflow-auto">
          <ProfileTable items={res.items} onOpen={open} />
        </div>
      )}
    </Card>
  )
}
