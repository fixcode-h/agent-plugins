import { CircleCheck, CircleDot, Flag, Square } from 'lucide-react'
import { useState } from 'react'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Note } from '../../ui.tsx'
import { commandSuggestion, editorStepTitle, editorVia, isEditorStep } from './gt-editor-steps.ts'
import type { RecordStatus } from './GtRecord.tsx'

/**
 * 录 UE 编辑器操作的录制中界面（定稿 10.1、效果图 7，GameTest 1.10.0）：和录游戏同一个样子（红点、名字、时长、步数、
 * 检查点、停止并保存），但走 gt.editrec.*。每步右边标它是从哪录来的（资产事件、选中事件、属性改动、界面点击……），
 * 界面点击找得到同名编辑器命令时提示「可换成命令」（录完在步骤详情里点）。
 */
export function GtEditorRecord({ status, onDone }: { status: RecordStatus; onDone: (saved?: string) => void }) {
  const { project } = useUe()
  const { ui, cn, toast } = h()
  const { busy, run } = useAction()
  const [mark, setMark] = useState('')
  const steps = status.last ?? []
  const secs = Math.round(status.seconds ?? 0)
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`

  const addMark = () =>
    run('mark', async () => {
      await op(project.id, 'gt.editrec.mark', { text: mark.trim() || t('检查点') })
      setMark('')
    })
  const stop = (save: boolean) =>
    run('stop', async () => {
      const r = await op<{ path?: string; steps?: number }>(project.id, 'gt.editrec.stop', { save })
      if (save && r.path) toast.success(t('已保存 {n} 步到 {p}', { n: r.steps ?? 0, p: r.path }))
      onDone(save ? r.path : undefined)
    })

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:bg-danger/8 ue:px-4 ue:py-2.5">
        <div className="ue:flex ue:items-center ue:gap-2.5">
          <span className="ue:h-2.5 ue:w-2.5 ue:shrink-0 ue:animate-pulse ue:rounded-full ue:bg-danger ue:ring-4 ue:ring-danger/20" />
          <span className="ue:truncate ue:text-body ue:font-medium ue:text-fg">
            {t('正在录编辑器操作「{name}」', { name: status.name ?? '' })}
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
          <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={addMark}>
            <Flag className="ue:h-3.5 ue:w-3.5" /> {t('检查点')}
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
        {EDITOR_RECORD_HELP()}
      </p>
      {status.modal && (
        <div className="ue:border-b ue:border-line ue:px-4 ue:py-2">
          <Note>
            {t('弹出了模态框「{w}」：已在这里记一笔。回放到这里可能卡住，录完给它加守护规则，或换成不弹框的做法', {
              w: status.modal,
            })}
          </Note>
        </div>
      )}
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
        {steps.map((s, i) => {
          const newest = i === steps.length - 1
          const index = (status.steps ?? steps.length) - steps.length + i
          const via = editorVia(s)
          const canCommand = !!commandSuggestion(s)
          return (
            <div
              key={i}
              className={cn(
                'ue:grid ue:h-9 ue:grid-cols-[22px_18px_112px_minmax(0,1fr)_auto] ue:items-center ue:gap-2 ue:border-b ue:border-line/55 ue:px-4',
                newest && 'ue:bg-run/8',
              )}
            >
              <span className="ue:text-right ue:text-caption ue:text-subtle ue:tabular-nums">{index + 1}</span>
              {newest ? (
                <CircleDot className="ue:h-3.5 ue:w-3.5 ue:text-danger" />
              ) : (
                <CircleCheck className="ue:h-3.5 ue:w-3.5 ue:text-success" />
              )}
              <span className="ue:truncate ue:font-mono ue:text-footnote ue:text-fg">{String(s.action ?? '')}</span>
              <span className="ue:truncate ue:text-footnote ue:text-muted">
                {isEditorStep(s.action) ? editorStepTitle(s) : String(s.text ?? s.note ?? '')}
              </span>
              <span className="ue:flex ue:items-center ue:gap-1.5">
                {canCommand && (
                  <span
                    className="ue:text-caption ue:text-accent"
                    title={t('找到了同名的编辑器命令，录完在步骤详情里点「换成命令」，回放不再依赖按钮位置')}
                  >
                    {t('可换成命令')}
                  </span>
                )}
                {via && (
                  <span className="ue:rounded-sm ue:bg-hover ue:px-1.5 ue:py-0.5 ue:text-caption ue:text-subtle">
                    {via}
                  </span>
                )}
              </span>
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

/** 录编辑器操作的说明：开始录制的对话框和录制中都显示 */
export const EDITOR_RECORD_HELP = () =>
  t(
    '在 UE 编辑器里正常操作：打开资源和关卡、选中、在细节面板改属性、放 Actor、编译、保存按编辑器事件录（换了布局也回放得了）；工具栏和菜单上的点击录成界面点击，能找到同名命令时提示换成命令；快捷键录成命令。按住 Ctrl+Alt 点一个控件录成检查（这一下不传给编辑器）。弹出模态框时记一笔。停止后存到场景根下的 recorded/。',
  )
