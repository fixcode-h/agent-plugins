import { getAt, type GtPath, type GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { useGtTidy } from '../GtTidy.tsx'
import type { ScriptApi } from './use-script.ts'

/**
 * 编辑页录制段节点上的「整理成流程」（定稿 8）：和场景详情页同一套 AI 整理（GtTidy.tsx），
 * 只是预填一句「只整理这一段」，Agent 改的是这个文件、其余步骤不动。整理读的是存盘的文件，所以先存盘
 */
export function useTidyHere(
  s: ScriptApi,
  o: { project: string; root: string; path: string; name: string; onSaved: () => void },
) {
  const tidy = useGtTidy(o)
  const start = async (path: GtPath) => {
    if (!s.doc) return
    if (s.dirty) {
      await s.save()
      o.onSaved()
    }
    const step = getAt(s.doc, path) as GtStep | undefined
    if (!step) return h().toast.error(t('这一步找不到了'))
    const name = typeof step.name === 'string' && step.name ? step.name : t('录制段')
    // 给 Agent 看的话，不翻译
    const id = typeof step.id === 'string' ? step.id : ''
    if (!id) return h().toast.error(t('这一步还没有 id，先存盘再整理'))
    tidy.ask(`整理录制段「${name}」里的步骤。`, id)
  }
  return { onTidy: (path: GtPath) => void start(path), dialogs: tidy.dialogs, tidy }
}
