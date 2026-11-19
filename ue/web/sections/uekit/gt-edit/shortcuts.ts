import { t } from '../../../host.ts'
import { COMMANDS } from './commands.ts'

/**
 * 编辑页的快捷键注册表（用户 2026-11-19：快捷键要能在设置里查到）：设置 → GameTest →「编辑快捷键」照这里列。
 * 编辑命令（列表和流程图共用）的按键写在命令表 commands.ts 里，这里直接取；整页的（保存、撤销）和某个视图自己的
 * （流程图的全选、聚焦）用 registerShortcut 登记，处理按键的代码按 id 找回 match，按键只在一处定义
 */
export interface Shortcut {
  id: string
  /** 显示的按键，几种按法用「 / 」隔开 */
  keys: string
  label: () => string
  /** 分组：在哪里能按 */
  scope: () => string
  match?: (e: KeyboardEvent | React.KeyboardEvent) => boolean
}

const mod = (e: KeyboardEvent | React.KeyboardEvent) => e.ctrlKey || e.metaKey
const PAGE = () => t('整页')

const registered: Shortcut[] = [
  {
    id: 'save',
    keys: 'Ctrl+S',
    label: () => t('保存'),
    scope: PAGE,
    match: (e) => mod(e) && e.key.toLowerCase() === 's',
  },
  {
    id: 'undo',
    keys: 'Ctrl+Z',
    label: () => t('撤销'),
    scope: PAGE,
    match: (e) => mod(e) && !e.shiftKey && e.key.toLowerCase() === 'z',
  },
  {
    id: 'redo',
    keys: 'Ctrl+Y / Ctrl+Shift+Z',
    label: () => t('重做'),
    scope: PAGE,
    match: (e) => mod(e) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z')),
  },
]

/** 登记一个快捷键（同 id 的替换掉） */
export function registerShortcut(s: Shortcut) {
  const i = registered.findIndex((x) => x.id === s.id)
  if (i >= 0) registered[i] = s
  else registered.push(s)
  return s
}

export const shortcutOf = (id: string) => registered.find((x) => x.id === id)

/** 设置页列的全部快捷键，按在哪里能按分组 */
export function allShortcuts(): { scope: string; items: { id: string; keys: string; label: string }[] }[] {
  const groups = new Map<string, { id: string; keys: string; label: string }[]>()
  const push = (scope: string, it: { id: string; keys: string; label: string }) =>
    groups.set(scope, [...(groups.get(scope) ?? []), it])
  for (const s of registered.filter((x) => x.scope() === PAGE()))
    push(s.scope(), { id: s.id, keys: s.keys, label: s.label() })
  const edit = t('选中的步骤（列表和流程图）')
  for (const c of COMMANDS) if (c.keys) push(edit, { id: c.id, keys: c.keys, label: c.label() })
  for (const s of registered.filter((x) => x.scope() !== PAGE()))
    push(s.scope(), { id: s.id, keys: s.keys, label: s.label() })
  return [...groups].map(([scope, items]) => ({ scope, items }))
}
