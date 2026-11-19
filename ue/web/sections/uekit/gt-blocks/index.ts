/**
 * 块 UI 注册表的入口：用的地方只 import 这个文件，保证所有块都注册过。
 * 兜底（原有动作）先注册，具体的块后注册；加新块：写一个文件、在这里加一行
 */
import './leaf.tsx'
import './group.tsx'
import './if.tsx'
import './loop.tsx'
import './call.tsx'
import './set.tsx'
import './invoke.tsx'
import './api.tsx'
import './control.tsx'
import './widget-ops.tsx'
import './cond-leaves.tsx'
import './leaf-items.ts'

export { blockUi, insertItems, TONE_BAR, TONE_TEXT, type BlockTone, type BlockUi, type InsertItem } from './registry.ts'
export { CommonFields, NoteField } from './parts.tsx'
