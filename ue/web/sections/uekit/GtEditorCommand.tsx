import { Terminal } from 'lucide-react'
import { useAction } from '../../api.ts'
import { h, t } from '../../host.ts'
import { commandSuggestion, toCommandPatch } from './gt-editor-steps.ts'
import { patchStep } from './gt-step-patch.ts'
import type { StepDef } from './GtStepDetail.tsx'

/**
 * 步骤详情里的「换成命令」（GameTest 1.11.0）：录编辑器时点的工具栏、菜单按钮，录制器找得到同名编辑器命令时记在 suggest 里。
 * 界面点击要按停靠页、文字、第几个找按钮，布局一换就找不到；换成 editor.command 只按命令名执行，回放更稳
 */
export function GtEditorCommand(o: {
  project: string
  root: string
  path: string
  index: number
  /** 所在槽（录制段里的步骤是 steps.N.do），不给时是顶层 steps */
  slot?: string
  def: StepDef
  locked?: boolean
  onChanged: () => void
}) {
  const { ui } = h()
  const { busy, run } = useAction()
  const c = commandSuggestion(o.def)
  const patch = toCommandPatch(o.def)
  if (!c || !patch) return null
  const swap = () =>
    run('command', async () => {
      await patchStep(o, o.index, o.def, patch)
      h().toast.success(t('已换成命令 {c}', { c: c.name }))
      o.onChanged()
    })
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      <p className="ue:text-subtle">
        {t('这个按钮对应编辑器命令 {c}。换成命令后回放直接执行命令，不再按界面位置找按钮', { c: c.name })}
      </p>
      <div>
        <ui.Button size="sm" variant="secondary" disabled={o.locked || !!busy} onClick={swap}>
          <Terminal className="ue:h-3.5 ue:w-3.5" /> {t('换成命令')}
        </ui.Button>
      </div>
    </div>
  )
}
