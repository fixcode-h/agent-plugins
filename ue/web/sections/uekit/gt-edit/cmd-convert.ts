import { ShieldPlus, UnfoldVertical } from 'lucide-react'
import { ensureIds, getAt, remove, replace, type GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { debugSession } from '../gt-debug/session.ts'
import { blankGuard } from '../gt-guards/model.ts'
import { callCopy } from './call-copy.ts'
import { registerCommand, roots, type CmdCtx } from './commands.ts'

/**
 * 流程和录制互相转化的两条命令（定稿 9.1 节点右键、9.7）：
 * - 包进守护：选中的几步挪进一条新的脚本守护的「做什么」（录到的「中途弹出又关掉」那几步变成守护），条件留给人填；
 * - 展开调用：调用脚本的节点换成那个脚本的一份副本（一个步骤段），参数变成段开头的设变量
 */
const inGuard = (c: CmdCtx) => c.selected.some((p) => p.includes('guards'))

registerCommand(
  {
    id: 'wrap-guard',
    group: 2,
    multi: true,
    label: () => t('包进守护'),
    icon: ShieldPlus,
    enabled: (c) => c.selected.length > 0 && !inGuard(c),
    run: (c) => {
      const list = roots(c.selected)
      const steps = list.map((p) => structuredClone(getAt(c.doc, p) as GtStep))
      const next = remove(c.doc, list)
      if (!next) return void h().toast.error(t('这几步挪不出来'))
      const guards = next.guards ?? []
      const g = { ...blankGuard(new Set(guards.map((x) => x.id ?? ''))), do: steps }
      if (c.apply({ ...next, guards: [...guards, g] })) {
        // 守护在「脚本设置」里编辑：清掉选中，右栏回到脚本设置
        c.select([])
        h().toast.success(t('已包成守护「{id}」：到右边「这个脚本的守护」里填什么时候触发', { id: g.id ?? '' }))
      }
    },
  },
  'wrap-loop',
)

async function inlineCall(c: CmdCtx) {
  const path = c.selected[0]
  let made: Awaited<ReturnType<typeof callCopy>>
  try {
    made = await callCopy(getAt(c.doc, path) as GtStep)
  } catch (e) {
    return void h().toast.error((e as Error).message)
  }
  const r = replace(c.doc, path, made.group)
  if (!r) return
  if (c.apply(ensureIds(r.doc))) c.select([path])
  if (made.warn) h().toast.error(made.warn)
}

registerCommand(
  {
    id: 'inline-call',
    group: 2,
    label: () => t('展开调用（换成副本）'),
    icon: UnfoldVertical,
    enabled: (c) =>
      c.selected.length === 1 &&
      (getAt(c.doc, c.selected[0]) as GtStep | undefined)?.action === 'call' &&
      !!debugSession(),
    run: (c) => void inlineCall(c),
  },
  'unwrap',
)
