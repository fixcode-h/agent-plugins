import {
  ArrowDown,
  ArrowUp,
  CircleDot,
  ClipboardPaste,
  Copy,
  CopyPlus,
  EyeOff,
  GitBranch,
  IndentDecrease,
  IndentIncrease,
  Layers,
  Play,
  Repeat,
  Scissors,
  SquareDashedMousePointer,
  Trash2,
  Ungroup,
  type LucideIcon,
  Sparkles,
} from 'lucide-react'
import {
  allSteps,
  comparePath,
  duplicate,
  getAt,
  indent,
  insert,
  isBlock,
  moveBy,
  outdent,
  placeOf,
  remove,
  replace,
  unwrap,
  wrap,
  type EditResult,
  type GtPath,
  type GtScript,
  type GtStep,
} from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import type { MenuItem } from '@panel/web/src/components/ui/item-menu'

/**
 * 编辑命令表：快捷键、右键菜单、工具栏都从这里取，一条命令一处定义（加命令就往表里加一项）。
 * 命令只调数据层的结构操作，视图不关心怎么改
 */
export interface CmdCtx {
  doc: GtScript
  selected: GtPath[]
  apply: (r: EditResult | GtScript | undefined, what?: string) => boolean
  select: (p: GtPath[]) => void
  /** 打开插入菜单（插在选中这一步后面） */
  openInsert?: () => void
  onTry?: (path: GtPath) => void
  /** 从这一步后面接着录（GameTest 1.10.0，编辑器连着时才有） */
  onRecordHere?: (path: GtPath) => void
  /** 录制段交给 Agent 整理成流程（gt-edit/tidy-here.ts） */
  onTidy?: (path: GtPath) => void
}

export interface EditCommand {
  id: string
  label: () => string
  icon: LucideIcon
  /** 菜单右边显示的快捷键 */
  keys?: string
  match?: (e: KeyboardEvent | React.KeyboardEvent) => boolean
  /** 没选中、选中多步时能不能用 */
  multi?: boolean
  enabled?: (c: CmdCtx) => boolean
  run: (c: CmdCtx) => void
  danger?: boolean
  /** 菜单里分组：同组挨着，组之间画分隔线 */
  group: number
}

const mod = (e: KeyboardEvent | React.KeyboardEvent) => e.ctrlKey || e.metaKey
const first = (c: CmdCtx) => c.selected[0]
const stepAt = (c: CmdCtx, p: GtPath) => getAt(c.doc, p) as GtStep | undefined
/** 选中的按文件顺序排；父块和它里面的步骤都选了时只留父块 */
export const roots = (sel: GtPath[]) => {
  const s = [...sel].sort(comparePath)
  return s.filter((p, i) => !s.slice(0, i).some((q) => q.length < p.length && q.every((x, k) => x === p[k])))
}

async function paste(c: CmdCtx) {
  let text = ''
  try {
    text = await navigator.clipboard.readText()
  } catch {
    h().toast.error(t('读不到剪贴板：浏览器没给权限'))
    return
  }
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    h().toast.error(t('剪贴板里不是步骤的 JSON'))
    return
  }
  const steps = (Array.isArray(v) ? v : [v]).filter(
    (s): s is GtStep => !!s && typeof s === 'object' && typeof (s as GtStep).action === 'string',
  )
  if (!steps.length) return h().toast.error(t('剪贴板里不是步骤的 JSON'))
  const at = first(c)
  const place = at && placeOf(c.doc, at)
  const slot = place ? place.slot : ['steps']
  const index = place ? place.index + 1 : ((getAt(c.doc, slot) as unknown[] | undefined)?.length ?? 0)
  c.apply(insert(c.doc, slot, index, steps))
}

export const COMMANDS: EditCommand[] = [
  {
    id: 'try',
    group: 0,
    label: () => t('试这一步'),
    icon: Play,
    keys: 'Ctrl+Enter',
    match: (e) => mod(e) && e.key === 'Enter',
    enabled: (c) => !!c.onTry && c.selected.length === 1,
    run: (c) => c.onTry?.(first(c)),
  },
  {
    id: 'record-here',
    group: 0,
    label: () => t('从这里接着录'),
    icon: CircleDot,
    enabled: (c) => !!c.onRecordHere && c.selected.length === 1,
    run: (c) => c.onRecordHere?.(first(c)),
  },
  {
    id: 'tidy-segment',
    group: 0,
    label: () => t('整理成流程'),
    icon: Sparkles,
    // 只给录制段：手写的段没有截图和录制线索，Agent 整理不出东西
    enabled: (c) => !!c.onTidy && c.selected.length === 1 && stepAt(c, first(c))?.recorded === true,
    run: (c) => c.onTidy?.(first(c)),
  },
  {
    id: 'insert',
    group: 1,
    label: () => t('在下面加一步'),
    icon: CopyPlus,
    keys: '/',
    match: (e) => !mod(e) && (e.key === '/' || e.key === 'Enter'),
    enabled: (c) => !!c.openInsert,
    run: (c) => c.openInsert?.(),
  },
  {
    id: 'duplicate',
    group: 1,
    label: () => t('复制一份'),
    icon: Copy,
    keys: 'Ctrl+D',
    match: (e) => mod(e) && e.key.toLowerCase() === 'd',
    run: (c) => c.apply(duplicate(c.doc, first(c))),
  },
  {
    id: 'copy',
    group: 1,
    multi: true,
    label: () => t('复制 JSON'),
    icon: Copy,
    keys: 'Ctrl+C',
    match: (e) => mod(e) && e.key.toLowerCase() === 'c' && !String(window.getSelection() ?? ''),
    run: (c) => {
      const steps = roots(c.selected).map((p) => stepAt(c, p))
      void navigator.clipboard.writeText(JSON.stringify(steps.length === 1 ? steps[0] : steps, null, 2))
      h().toast.success(t('已复制 {n} 步', { n: steps.length }))
    },
  },
  {
    id: 'cut',
    group: 1,
    multi: true,
    label: () => t('剪切'),
    icon: Scissors,
    keys: 'Ctrl+X',
    match: (e) => mod(e) && e.key.toLowerCase() === 'x' && !String(window.getSelection() ?? ''),
    run: (c) => {
      const list = roots(c.selected)
      const steps = list.map((p) => stepAt(c, p))
      void navigator.clipboard.writeText(JSON.stringify(steps.length === 1 ? steps[0] : steps, null, 2))
      if (c.apply(remove(c.doc, list))) {
        c.select([])
        h().toast.success(t('已剪切 {n} 步', { n: steps.length }))
      }
    },
  },
  {
    id: 'paste',
    group: 1,
    label: () => t('粘贴到下面'),
    icon: ClipboardPaste,
    keys: 'Ctrl+V',
    match: (e) => mod(e) && e.key.toLowerCase() === 'v',
    enabled: () => true,
    run: (c) => void paste(c),
  },
  {
    id: 'wrap-group',
    group: 2,
    multi: true,
    label: () => t('包成段'),
    icon: Layers,
    keys: 'Ctrl+G',
    match: (e) => mod(e) && !e.shiftKey && e.key.toLowerCase() === 'g',
    run: (c) => c.apply(wrap(c.doc, roots(c.selected), 'group'), t('要选同一层里的步骤')),
  },
  {
    id: 'wrap-if',
    group: 2,
    multi: true,
    label: () => t('包进如果'),
    icon: GitBranch,
    run: (c) => c.apply(wrap(c.doc, roots(c.selected), 'if'), t('要选同一层里的步骤')),
  },
  {
    id: 'wrap-loop',
    group: 2,
    multi: true,
    label: () => t('包进循环'),
    icon: Repeat,
    run: (c) => c.apply(wrap(c.doc, roots(c.selected), 'loop'), t('要选同一层里的步骤')),
  },
  {
    id: 'unwrap',
    group: 2,
    label: () => t('展开（去掉这一层）'),
    icon: Ungroup,
    keys: 'Ctrl+Shift+G',
    match: (e) => mod(e) && e.shiftKey && e.key.toLowerCase() === 'g',
    enabled: (c) => c.selected.length === 1 && isBlock(stepAt(c, first(c))),
    run: (c) => c.apply(unwrap(c.doc, first(c)), t('其他分支里还有步骤，先挪走才能展开')),
  },
  {
    id: 'indent',
    group: 3,
    label: () => t('放进上面的块'),
    icon: IndentIncrease,
    keys: 'Tab',
    match: (e) => e.key === 'Tab' && !e.shiftKey,
    run: (c) => c.apply(indent(c.doc, first(c)), t('上面一步不是块')),
  },
  {
    id: 'outdent',
    group: 3,
    label: () => t('移出块'),
    icon: IndentDecrease,
    keys: 'Shift+Tab',
    match: (e) => e.key === 'Tab' && e.shiftKey,
    run: (c) => c.apply(outdent(c.doc, first(c)), t('已经在最外层')),
  },
  {
    id: 'up',
    group: 3,
    label: () => t('往上挪'),
    icon: ArrowUp,
    keys: 'Alt+↑',
    match: (e) => e.altKey && e.key === 'ArrowUp',
    run: (c) => c.apply(moveBy(c.doc, first(c), -1), t('到顶了')),
  },
  {
    id: 'down',
    group: 3,
    label: () => t('往下挪'),
    icon: ArrowDown,
    keys: 'Alt+↓',
    match: (e) => e.altKey && e.key === 'ArrowDown',
    run: (c) => c.apply(moveBy(c.doc, first(c), 1), t('到底了')),
  },
  {
    id: 'disable',
    group: 4,
    multi: true,
    label: () => t('停用 / 启用'),
    icon: EyeOff,
    keys: 'Ctrl+/',
    match: (e) => mod(e) && e.key === '/',
    run: (c) => {
      const list = roots(c.selected)
      const off = !list.every((p) => stepAt(c, p)?.disabled === true)
      let doc = c.doc
      for (const p of list) {
        const s = { ...(getAt(doc, p) as GtStep) }
        if (off) s.disabled = true
        else delete s.disabled
        doc = replace(doc, p, s)?.doc ?? doc
      }
      c.apply(doc)
      c.select(c.selected)
    },
  },
  {
    id: 'remove',
    group: 4,
    multi: true,
    danger: true,
    label: () => t('删掉'),
    icon: Trash2,
    keys: 'Delete',
    match: (e) => e.key === 'Delete' || (e.key === 'Backspace' && mod(e)),
    run: (c) => {
      const list = roots(c.selected)
      const place = placeOf(c.doc, list[0])
      const next = remove(c.doc, list)
      if (!c.apply(next) || !next || !place) return
      // 删完选中原位置上的那一步（没有了就选上一步），键盘可以接着删
      const near = [place.index, place.index - 1].map((i) => [...place.slot, i]).find((p) => getAt(next, p))
      c.select(near ? [near] : [])
    },
  },
  {
    id: 'select-all',
    group: 4,
    multi: true,
    label: () => t('全选'),
    icon: SquareDashedMousePointer,
    keys: 'Ctrl+A',
    match: (e) => mod(e) && e.key.toLowerCase() === 'a',
    enabled: () => true,
    // 只选最外层的（块里的跟着块走），复制、删、包成段都按最外层算
    run: (c) =>
      c.select(
        allSteps(c.doc)
          .filter((e) => e.depth === 0)
          .map((e) => e.path),
      ),
  },
]

/**
 * 别的模块加命令（调试的 F9、运行到这里，转化的包进守护、展开调用）：插在 after 那条后面，没给插在同组最后。
 * 同 id 的替换掉
 */
export function registerCommand(cmd: EditCommand, after?: string) {
  const old = COMMANDS.findIndex((x) => x.id === cmd.id)
  if (old >= 0) COMMANDS.splice(old, 1)
  let at = after ? COMMANDS.findIndex((x) => x.id === after) + 1 : 0
  if (at <= 0) {
    const last = COMMANDS.map((x) => x.group).lastIndexOf(cmd.group)
    at = last >= 0 ? last + 1 : COMMANDS.length
  }
  COMMANDS.splice(at, 0, cmd)
}

export const canRun = (cmd: EditCommand, c: CmdCtx) =>
  (cmd.enabled ? cmd.enabled(c) : c.selected.length > 0) && (cmd.multi || c.selected.length <= 1 || cmd.id === 'paste')

/** 按键 → 命令；没有对应命令时返回 false，按键照常传下去 */
export function runKey(e: React.KeyboardEvent, c: CmdCtx) {
  const cmd = COMMANDS.find((x) => x.match?.(e))
  if (!cmd || !canRun(cmd, c)) return false
  e.preventDefault()
  cmd.run(c)
  return true
}

/**
 * 右键菜单：整张命令表按组排，组之间画分隔线，做不了的灰掉。列表视图的行、流程图的节点都用这一份，
 * 插入单独走插入菜单（这里不列）
 */
export function commandMenuItems(c: CmdCtx): MenuItem[] {
  const items: MenuItem[] = []
  let g = -1
  for (const cmd of COMMANDS) {
    if (cmd.id === 'insert') continue
    if (g >= 0 && cmd.group !== g) items.push('sep')
    g = cmd.group
    items.push({
      label: cmd.label(),
      icon: cmd.icon,
      hint: cmd.keys,
      danger: cmd.danger,
      disabled: !canRun(cmd, c),
      onClick: () => cmd.run(c),
    })
  }
  return items
}
