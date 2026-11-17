import { Camera, CircleCheck, CircleDot, Flag, Square } from 'lucide-react'
import { useState } from 'react'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Note } from '../../ui.tsx'
import { humanStep } from './gt-steps.ts'
import { moveLine } from './gt-move.ts'
import { GtRecordQuick, type RecordQuick } from './GtRecordQuick.tsx'

/**
 * 录制中的界面（效果图 5）：顶上红点、名字、时长和步数，检查点 / 截图检查点 / 停止并保存；
 * 下面是录到的步骤，最新一步高亮。步骤靠 gt.record 推送事件追加。
 */
export interface RecordStatus extends RecordQuick {
  recording: boolean
  name?: string
  steps?: number
  seconds?: number
  last?: Record<string, unknown>[]
  /** 录制器认「谁接住了输入」靠什么：slateDebugging 准；hitPath 是这个进程没编 Slate 调试，按命中路径推断 */
  handlerSource?: 'slateDebugging' | 'hitPath' | string
  keepPace?: boolean
}

/** handlerSource=hitPath 时的提示：开始录制前（对话框里）和录制中都显示 */
export function HitPathNote() {
  return (
    <Note>
      {t(
        '这个进程没编 Slate 调试（WITH_SLATE_DEBUGGING 关着），录制器只能按光标下的控件推断：点击照样能录，输入框里打的字录不到，要录输入换 Development 编辑器或手写 type 步骤',
      )}
    </Note>
  )
}

/** 录到的一步写成一行：有 hint 的 UI 步骤用人话（选择器放后面），其余列出参数 */
function describe(s: Record<string, unknown>) {
  if (s.action === 'move') return moveLine(s)
  const human = humanStep(s)
  if (human) return [human, s.target as string | undefined].filter(Boolean).join(' · ')
  const rest = Object.entries(s)
    .filter(([k]) => k !== 'action' && k !== 'note' && k !== 'hint')
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
            {status.keepPace ? ` · ${t('保留节奏')}` : ''}
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
        <GtRecordQuick status={status} />
      </div>
      <p className="ue:border-b ue:border-line ue:px-4 ue:py-2 ue:text-footnote ue:leading-relaxed ue:text-subtle">
        {t(
          '在游戏窗口里正常操作就行：点控件录成对这个控件的点击，打字录成输入，点在游戏画面上和按键录成真实按键；按住 Ctrl+Alt 点一个控件录成断言（这一下不传给游戏）。要让角色走到某处，点「录移动」再走过去、到了点「结束移动」，回放时角色自己寻路走过去。游戏窗口右上角也有这条工具栏，鼠标被游戏锁住时按 Alt+数字；工具栏、快捷键本身和编辑器其他面板上的操作都不录。停止后存到场景根下的 recorded/。',
        )}
      </p>
      {status.handlerSource === 'hitPath' && (
        <div className="ue:border-b ue:border-line ue:px-4 ue:py-2">
          <HitPathNote />
        </div>
      )}
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
