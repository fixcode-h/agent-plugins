import { h, t } from '../../../host.ts'
import { Badge, Dot } from '../../../ui.tsx'
import type { ObjState } from './tree-model.ts'

/**
 * Lua 对象的状态（设计稿第三节）：活着、待回收（已标记销毁，下次 UE 垃圾回收收掉，正常现象）、
 * 世界已关（Actor、组件、控件所在的世界已经关了，多半是没释放）、已销毁但 Lua 还拿着（lua.leaks 查出来的）。
 * 树、检视区头部、设置里的组件示例共用
 */
export type ShownState = ObjState | 'destroyed'

const STATES: Record<ShownState, { dot: 'ok' | 'muted' | 'warn' | 'danger'; tone: 'ok' | 'muted' | 'warn' | 'danger'; label: () => string; hint: () => string }> = {
  alive: { dot: 'ok', tone: 'ok', label: () => t('活着'), hint: () => t('UObject 有效，实例表能读能调') },
  garbage: {
    dot: 'muted',
    tone: 'muted',
    label: () => t('待回收'),
    hint: () => t('UObject 已标记销毁，下次 UE 垃圾回收时收掉；字段还能读，调它的 UE 函数可能失败'),
  },
  noworld: {
    dot: 'warn',
    tone: 'warn',
    label: () => t('世界已关'),
    hint: () => t('对象还在，但它所在的世界已经关了：多半是切关卡后还被拿着没释放'),
  },
  destroyed: {
    dot: 'danger',
    tone: 'danger',
    label: () => t('已销毁，Lua 还拿着'),
    hint: () => t('UObject 已经被 UE 回收，Lua 里还有表或 upvalue 拿着它的实例表，Lua 的垃圾回收收不掉'),
  },
}

export function StateDot({ state }: { state: ShownState }) {
  return (
    <span title={STATES[state].label()} className="ue:inline-flex">
      <Dot tone={STATES[state].dot} />
    </span>
  )
}

export function StateBadge({ state }: { state: ShownState }) {
  const s = STATES[state]
  return (
    <Badge tone={s.tone} title={s.hint()}>
      {s.label()}
    </Badge>
  )
}

export const stateHint = (s: ShownState) => STATES[s].hint()

/** 树底下的图例：四种状态的点各是什么意思 */
export function StateLegend() {
  const { cn } = h()
  return (
    <div className={cn('ue:flex ue:flex-wrap ue:gap-x-3 ue:gap-y-1 ue:border-t ue:border-line ue:px-3 ue:py-1.5')}>
      {(Object.keys(STATES) as ShownState[]).map((k) => (
        <span key={k} title={STATES[k].hint()} className="ue:flex ue:items-center ue:gap-1 ue:text-caption ue:text-subtle">
          <Dot tone={STATES[k].dot} /> {STATES[k].label()}
        </span>
      ))}
    </div>
  )
}

/** UELink 的世界 id（同 outliner）→ 给人看的名字；空的是已经关掉的世界 */
export function worldName(id: string) {
  if (!id) return t('已关的世界')
  if (id === 'editor') return t('编辑器世界')
  if (id === 'game') return t('游戏世界')
  const m = /^pie(\d+)$/.exec(id)
  return m ? t('PIE 实例 {n}', { n: m[1] }) : id
}
