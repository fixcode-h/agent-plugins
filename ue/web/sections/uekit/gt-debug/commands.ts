import { CircleDot, SkipForward, StepForward } from 'lucide-react'
import { getAt, type GtPath, type GtStep } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { registerCommand, type CmdCtx } from '../gt-edit/commands.ts'
import { stepKey } from '../gt-flow/layout.ts'
import { breakpoints, setBreakpoints } from './breakpoints.ts'
import { debugSession } from './session.ts'

/**
 * 调试命令（定稿 9.1「节点右键：设断点」、9.2「从这里运行、运行到这里」，列表视图的 F9）：
 * 进编辑命令表，右键菜单、快捷键和别的命令一样从表里取
 */
const keyOf = (c: CmdCtx, p: GtPath) => {
  const s = getAt(c.doc, p) as GtStep | undefined
  return s && typeof s === 'object' ? stepKey(s, p) : undefined
}
const canStart = (c: CmdCtx) => c.selected.length === 1 && !!debugSession()?.run && !debugSession()?.running

registerCommand(
  {
    id: 'breakpoint',
    group: 0,
    multi: true,
    label: () => t('设断点 / 取消断点'),
    icon: CircleDot,
    keys: 'F9',
    match: (e) => e.key === 'F9',
    run: (c) => {
      const keys = c.selected.map((p) => keyOf(c, p)).filter((k): k is string => !!k)
      const s = new Set(breakpoints())
      // 选了几步时：有一步没设就全设上，全设了就全取消
      const on = keys.some((k) => !s.has(k))
      for (const k of keys) {
        if (on) s.add(k)
        else s.delete(k)
      }
      setBreakpoints(s)
    },
  },
  'try',
)

registerCommand(
  {
    id: 'run-to',
    group: 0,
    label: () => t('运行到这里'),
    icon: StepForward,
    enabled: canStart,
    run: (c) => {
      const k = keyOf(c, c.selected[0])
      if (k) debugSession()?.run?.({ to: k })
    },
  },
  'breakpoint',
)

registerCommand(
  {
    id: 'run-from',
    group: 0,
    label: () => t('从这里运行'),
    icon: SkipForward,
    enabled: canStart,
    run: (c) => {
      const k = keyOf(c, c.selected[0])
      if (k) debugSession()?.run?.({ from: k })
    },
  },
  'run-to',
)
