import { ClipboardPaste, Copy, Wand2 } from 'lucide-react'
import { getAt, replace, type GtStep } from '../../../../shared/gt-script/index.ts'
import { HOOK_GROUPS, hookCount, hooksOf, pasteHooks, type HookGroup } from '../../../../shared/gt-script/gm/hooks.ts'
import { h, t } from '../../../host.ts'
import { registerCommand, type CmdCtx } from '../gt-edit/commands.ts'

/**
 * 节点右键的「附带 GM」几项（测试页梳理 G12）：加 GM 到某一组、复制 / 粘贴别的节点的附带 GM。
 * 「加 GM…」要弹选 GM 的窗：命令只选中这一步并发个请求，检查器里的 HooksEditor 收到后打开它（选中一步时检查器一定在）
 */

type AddListener = (g: HookGroup) => void
const listeners = new Set<AddListener>()
let pending: HookGroup | undefined

/** HooksEditor 挂上时订阅；挂上前发出的请求（右键时检查器还没换到这一步）挂着等它来取 */
export function onAddRequest(fn: AddListener) {
  listeners.add(fn)
  if (pending) {
    const g = pending
    pending = undefined
    fn(g)
  }
  return () => {
    listeners.delete(fn)
  }
}

function requestAdd(c: CmdCtx, g: HookGroup) {
  c.select([c.selected[0]])
  if (listeners.size) for (const fn of listeners) fn(g)
  else pending = g
}

/** 复制的附带 GM 只在面板里留一份（不进系统剪贴板：和步骤 JSON 的复制粘贴分开，不会粘成一步） */
let copied: GtStep | undefined

const stepOf = (c: CmdCtx) => (c.selected.length === 1 ? (getAt(c.doc, c.selected[0]) as GtStep | undefined) : undefined)

const ADD_LABEL: Record<HookGroup, () => string> = {
  before: () => t('附带 GM：执行前加一条…'),
  after: () => t('附带 GM：成功后加一条…'),
  fail: () => t('附带 GM：失败时加一条…'),
}

for (const g of HOOK_GROUPS)
  registerCommand({
    id: `hooks-add-${g}`,
    group: 5,
    label: ADD_LABEL[g],
    icon: Wand2,
    enabled: (c) => !!stepOf(c),
    run: (c) => requestAdd(c, g),
  })

registerCommand({
  id: 'hooks-copy',
  group: 5,
  label: () => t('复制附带 GM'),
  icon: Copy,
  enabled: (c) => {
    const s = stepOf(c)
    return !!s && hookCount(s) > 0
  },
  run: (c) => {
    const s = stepOf(c)
    if (!s) return
    copied = { action: s.action, hooks: structuredClone(hooksOf(s)) }
    h().toast.success(t('已复制 {n} 条附带 GM', { n: hookCount(s) }))
  },
})

registerCommand({
  id: 'hooks-paste',
  group: 5,
  label: () => t('粘贴附带 GM'),
  icon: ClipboardPaste,
  enabled: (c) => !!copied && !!stepOf(c),
  run: (c) => {
    const s = stepOf(c)
    if (!s || !copied) return
    c.apply(replace(c.doc, c.selected[0], pasteHooks(s, copied)))
  },
})
