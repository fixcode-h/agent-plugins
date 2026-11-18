import type { CondNode } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { checkOf } from '../gt-vars/VarsDialog.tsx'
import type { VarGroup, VarItem, VarsReply } from '../gt-vars/model.ts'
import type { Picked } from './use-pick.ts'
import type { WatchItems } from './use-watch.ts'

/** gt.resolve targets 的一项：控件此刻在不在、显不显示、能不能点、文字 */
export interface TargetState {
  found?: boolean
  visible?: boolean
  enabled?: boolean
  text?: string
  class?: string
  error?: string
}

export type StateKey = 'visible' | 'enabled' | 'text' | 'checked'

/** 控件状态那几行（效果图 3「控件状态 · UButton」）：勾选框多一行「勾上」，文字控件不列「能点」 */
export function stateRows(kind: Picked['kind'], st: TargetState | undefined, checked: boolean | undefined) {
  const rows: { id: StateKey; label: string; value: unknown }[] = [
    { id: 'visible', label: t('可见'), value: st?.visible },
  ]
  if (kind !== 'text') rows.push({ id: 'enabled', label: t('能点（启用）'), value: st?.enabled })
  rows.push({ id: 'text', label: t('文字'), value: st?.text ?? '' })
  if (kind === 'check') rows.push({ id: 'checked', label: t('勾上'), value: checked })
  return rows
}

/** 选中一行状态 → 判断：默认等于此刻的值，改起来最快 */
export const stateCond = (target: string, id: StateKey, value: unknown): CondNode => ({
  target,
  [id]: id === 'text' ? String(value ?? '') : value !== false,
})

/** 选中所在界面的一个字段 → 判断：target 用抓到的界面选择器（同一个 WBP 有几份时也指得准） */
export function fieldCond(screen: string, reply: VarsReply, g: VarGroup, it: VarItem): CondNode {
  const c = checkOf({ scope: 'widget', class: reply.owner?.class ?? screen }, g, it)
  return { ...c, target: screen }
}

/**
 * 抓到控件后要实时看的几样（gt.watch，每 0.2 秒）：控件状态、勾选框勾没勾、所在界面的字段（只有拼条件时要）
 */
export function pickWatchItems(
  target: string,
  picked: Picked | undefined,
  withFields: boolean,
): WatchItems | undefined {
  if (!target) return undefined
  const same = picked?.target === target
  const items: WatchItems = { state: { op: 'gt.resolve', args: { targets: [target] } } }
  if (same && picked?.kind === 'check')
    items.checked = { op: 'gt.resolve', args: { conds: [{ id: 'c', cond: { target, checked: true } }] } }
  const screen = same ? picked?.screen : undefined
  if (withFields && screen)
    items.fields = {
      op: 'gt.vars',
      args: { scope: 'widget', target: screen, values: true, functions: false, limit: 200 },
    }
  return items
}

/** 字段的值按 路径 → 文字 摊平：比较哪些字段这一次变了 */
export function fieldValues(reply: VarsReply | undefined) {
  const out = new Map<string, string>()
  for (const g of reply?.groups ?? [])
    for (const it of g.items)
      out.set(`${g.src}:${g.class ?? g.file ?? ''}:${it.path}`, JSON.stringify(it.value ?? null))
  return out
}
