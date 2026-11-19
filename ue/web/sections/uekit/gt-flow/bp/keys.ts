import { t } from '../../../../host.ts'
import { registerShortcut } from '../../gt-edit/shortcuts.ts'

/**
 * 流程图画布自己的快捷键（用户 2026-11-19：框选后 Delete 删、补常用快捷键，照 UE 蓝图的习惯）。
 * 删、复制、粘贴、剪切、复制一份、撤销重做走编辑命令表（列表和流程图共用），这里只放画布才有的；
 * 登记进快捷键注册表，设置 → GameTest →「编辑快捷键」能查到
 */
const mod = (e: KeyboardEvent | React.KeyboardEvent) => e.ctrlKey || e.metaKey
const plain = (e: KeyboardEvent | React.KeyboardEvent) => !mod(e) && !e.altKey && !e.shiftKey
const CANVAS = () => t('流程图画布')

export const CANVAS_KEYS = {
  selectAll: registerShortcut({
    id: 'canvas-select-all',
    keys: 'Ctrl+A',
    label: () => t('全选这一层的节点'),
    scope: CANVAS,
    match: (e) => mod(e) && !e.shiftKey && e.key.toLowerCase() === 'a',
  }),
  focus: registerShortcut({
    id: 'canvas-focus',
    keys: 'F',
    label: () => t('聚焦选中的节点（没选就看全部）'),
    scope: CANVAS,
    match: (e) => plain(e) && e.key.toLowerCase() === 'f',
  }),
  fit: registerShortcut({
    id: 'canvas-fit',
    keys: 'Home',
    label: () => t('看全部'),
    scope: CANVAS,
    match: (e) => plain(e) && e.key === 'Home',
  }),
  search: registerShortcut({
    id: 'canvas-search',
    keys: 'Ctrl+F',
    label: () => t('搜索节点'),
    scope: CANVAS,
    match: (e) => mod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f',
  }),
  deselect: registerShortcut({
    id: 'canvas-deselect',
    keys: 'Esc',
    label: () => t('取消选中'),
    scope: CANVAS,
    match: (e) => e.key === 'Escape',
  }),
  enter: registerShortcut({
    id: 'canvas-enter',
    keys: 'Ctrl+↓ / 双击',
    label: () => t('进到选中的子图里面（挂的用例：打开那个脚本）'),
    scope: CANVAS,
    match: (e) => mod(e) && !e.altKey && e.key === 'ArrowDown',
  }),
  leave: registerShortcut({
    id: 'canvas-leave',
    keys: 'Ctrl+↑ / Backspace',
    label: () => t('回到上一层'),
    scope: CANVAS,
    match: (e) => (mod(e) && !e.altKey && e.key === 'ArrowUp') || (plain(e) && e.key === 'Backspace'),
  }),
}
