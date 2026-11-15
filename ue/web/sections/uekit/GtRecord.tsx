import { Camera, CircleCheck, CircleDot, Flag, Square } from 'lucide-react'
import { useState } from 'react'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'

/**
 * 录制中的界面（效果图 5）：顶上红点、名字、时长和步数，检查点 / 截图检查点 / 停止并保存；
 * 下面是录到的步骤，最新一步高亮。步骤靠 gt.record 推送事件追加。
 */
export interface RecordStatus {
  recording: boolean
  name?: string
  steps?: number
  seconds?: number
  last?: Record<string, unknown>[]
}

function describe(s: Record<string, unknown>) {
  const rest = Object.entries(s)
    .filter(([k]) => k !== 'action' && k !== 'note')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ')
  return [s.target as string | undefined, s.note as string | undefined, rest].filter(Boolean).join(' · ')
}

export function GtRecord({ status, onDone }: { status: RecordStatus; onDone: () => void }) {
  const { project } = useUe()
  const { ui, cn, toast } = h()
  const { busy, run } = useAction()
  const [mark, setMark] = useState('')
  const steps = status.last ?? []
  const secs = Math.round(status.seconds ?? 0)
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`

  const addMark = (screenshot: boolean) =>
    run('mark', async () => {
      await op(project.id, 'gt.record.mark', { text: mark.trim() || t('检查点'), screenshot })
      setMark('')
    })
  const stop = (save: boolean) =>
    run('stop', async () => {
      const r = await op<{ path?: string; steps?: number }>(project.id, 'gt.record.stop', { save })
      if (save && r.path) toast.success(t('已保存 {n} 步到 {p}', { n: r.steps ?? 0, p: r.path }))
      onDone()
    })

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:bg-danger/8 ue:px-4 ue:py-2.5">
        <div className="ue:flex ue:items-center ue:gap-2.5">
          <span className="ue:h-2.5 ue:w-2.5 ue:shrink-0 ue:animate-pulse ue:rounded-full ue:bg-danger ue:ring-4 ue:ring-danger/20" />
          <span className="ue:truncate ue:text-body ue:font-medium ue:text-fg">
            {t('正在录制「{name}」', { name: status.name ?? '' })}
          </span>
          <span className="ue:shrink-0 ue:text-footnote ue:text-subtle ue:tabular-nums">
            {time} · {t('{n} 步', { n: status.steps ?? steps.length })}
          </span>
        </div>
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
          <ui.Input
            size="sm"
            className="ue:w-48"
            value={mark}
            placeholder={t('检查点说明（可不填）')}
            onChange={(e: { target: { value: string } }) => setMark(e.target.value)}
          />
          <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={() => addMark(false)}>
            <Flag className="ue:h-3.5 ue:w-3.5" /> {t('检查点')}
          </ui.Button>
          <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={() => addMark(true)}>
            <Camera className="ue:h-3.5 ue:w-3.5" /> {t('截图检查点')}
          </ui.Button>
          <span className="ue:flex-1" />
          <ui.Button size="sm" variant="ghost" disabled={!!busy} onClick={() => stop(false)}>
            {t('放弃')}
          </ui.Button>
          <ui.Button size="sm" variant="danger" disabled={!!busy} onClick={() => stop(true)}>
            <Square className="ue:h-3.5 ue:w-3.5" /> {t('停止并保存')}
          </ui.Button>
        </div>
      </div>
      <p className="ue:border-b ue:border-line ue:px-4 ue:py-2 ue:text-footnote ue:leading-relaxed ue:text-subtle">
        {t(
          '在游戏窗口里正常操作就行：点控件录成选择器，按键录成真实按键，停顿录成等待。编辑器其他面板上的操作不录。停止后存到场景根下的 recorded/。',
        )}
      </p>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
        {steps.map((s, i) => {
          const newest = i === steps.length - 1
          return (
            <div
              key={i}
              className={cn(
                'ue:grid ue:h-9 ue:grid-cols-[22px_18px_104px_minmax(0,1fr)] ue:items-center ue:gap-2 ue:border-b ue:border-line/55 ue:px-4',
                newest && 'ue:bg-run/8',
              )}
            >
              <span className="ue:text-right ue:text-caption ue:text-subtle ue:tabular-nums">
                {(status.steps ?? steps.length) - steps.length + i + 1}
              </span>
              {newest ? (
                <CircleDot className="ue:h-3.5 ue:w-3.5 ue:text-danger" />
              ) : (
                <CircleCheck className="ue:h-3.5 ue:w-3.5 ue:text-success" />
              )}
              <span className="ue:truncate ue:font-mono ue:text-footnote ue:text-fg">{String(s.action ?? '')}</span>
              <span className="ue:truncate ue:text-footnote ue:text-muted">{describe(s)}</span>
            </div>
          )
        })}
        {!steps.length && (
          <p className="ue:px-4 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">{t('还没录到操作')}</p>
        )}
      </div>
    </div>
  )
}
