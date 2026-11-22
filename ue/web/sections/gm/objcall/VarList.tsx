import { Copy, Pencil, Plus, Variable, X } from 'lucide-react'
import type { Prop } from '../../../details/model.ts'
import { h, t } from '../../../host.ts'
import { copyText, openMenu } from '../../../menu.tsx'

/** 中栏选中的一个变量（UE 属性或 Lua 字段）：右栏「改变量」按它抓取值、写回 */
export interface VarSel {
  /** obj.set / gt.props 认的属性路径（@.Count） */
  prop: string
  name: string
  type: string
  lua: boolean
  value?: unknown
  readOnly?: boolean
  why?: string
  enum?: string[]
}

export const varOf = (p: Prop, lua: boolean): VarSel => ({
  prop: p.name,
  name: p.displayName ?? p.name,
  type: p.type,
  lua,
  value: p.value,
  readOnly: p.readOnly,
  why: p.readOnlyWhy,
  enum: p.enum,
})

/** 列表里值的一行摘要 */
export const valueText = (v: unknown) =>
  v === undefined ? '' : typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v)

/**
 * 对象调用中栏的属性 / Lua 字段 / 运行状态列表（用户 2026-11-22：点变量在右栏展示，抓取值、填新值、点「修改」）。
 * 一行：图标、名字、类型、此刻的值；按分类分组，和「方法」列表同一个样子。取对象时行尾 ＋ / × 挑要读的属性
 */
export function VarList({
  list,
  lua,
  q,
  selected,
  onPick,
  picking,
  picked,
  onTogglePick,
}: {
  list: Prop[]
  lua: boolean
  q: string
  selected?: string
  onPick: (v: VarSel) => void
  picking: boolean
  picked: string[]
  onTogglePick: (prop: string) => void
}) {
  const { cn } = h()
  const k = q.trim().toLowerCase()
  const shown = k ? list.filter((p) => `${p.displayName ?? ''} ${p.name}`.toLowerCase().includes(k)) : list
  let last = ''
  return (
    <>
      {shown.map((p) => {
        const head = (p.category ?? '') !== last
        last = p.category ?? ''
        const on = picked.includes(p.name)
        return (
          <div key={p.name}>
            {head && p.category && (
              <div className="ue:px-2 ue:pt-2 ue:pb-1 ue:text-caption ue:font-medium ue:text-muted">{p.category}</div>
            )}
            <div
              role="button"
              tabIndex={0}
              title={p.readOnly ? p.readOnlyWhy || t('只读') : p.name}
              onClick={() => onPick(varOf(p, lua))}
              onKeyDown={(e) => e.key === 'Enter' && onPick(varOf(p, lua))}
              onContextMenu={(e) =>
                openMenu(e, [
                  {
                    label: p.readOnly ? t('查看') : t('改这个变量'),
                    icon: Pencil,
                    onClick: () => onPick(varOf(p, lua)),
                  },
                  'sep',
                  { label: t('复制名字'), icon: Copy, onClick: () => copyText(p.displayName ?? p.name) },
                  { label: t('复制路径'), icon: Copy, onClick: () => copyText(p.name) },
                ])
              }
              className={cn(
                'ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-md ue:px-2 ue:py-1.5 ue:text-left ue:text-footnote ue:outline-none ue:focus-visible:bg-hover',
                selected === p.name ? 'ue:bg-sel' : 'ue:hover:bg-hover',
              )}
            >
              <Variable className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
              <span className={cn('ue:font-mono', p.readOnly ? 'ue:text-muted' : 'ue:text-fg')}>
                {p.displayName ?? p.name}
              </span>
              <span className="ue:shrink-0 ue:font-mono ue:text-caption ue:text-subtle">{p.type}</span>
              <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-right ue:font-mono ue:text-caption ue:text-muted">
                {valueText(p.value)}
              </span>
              {picking && (
                <button
                  type="button"
                  title={on ? t('不读这个属性') : t('取对象时读这个属性')}
                  onClick={(e) => {
                    e.stopPropagation()
                    onTogglePick(p.name)
                  }}
                  className="ue:grid ue:shrink-0 ue:cursor-pointer ue:text-subtle ue:hover:text-accent"
                >
                  {on ? <X className="ue:h-3.5 ue:w-3.5" /> : <Plus className="ue:h-3.5 ue:w-3.5" />}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}
