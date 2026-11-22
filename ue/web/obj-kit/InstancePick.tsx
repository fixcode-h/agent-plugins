import { Check, X } from 'lucide-react'
import { h, t } from '../host.ts'
import type { RefHits } from '../sections/uekit/gt-ref/live.ts'

/**
 * 挑实例条（GM 页梳理 F2，效果图 3）：对象命中多个时在头卡下面列出此刻命中的实例，点一下勾上 / 去掉；
 * 勾了的话本次调用、读取、改值只对勾的生效（shared/gm/pick.ts 收窄规则），不勾就按「命中多个时」的设置。
 * 只管画，勾了哪些由调用方存（换对象清空）
 */
export function InstancePick({
  hit,
  only,
  onOnly,
}: {
  hit?: RefHits
  only: string[]
  onOnly: (names: string[]) => void
}) {
  const { ui, cn } = h()
  const list = hit?.candidates ?? []
  if (list.length < 2 && !only.length) return null
  const toggle = (n: string) => onOnly(only.includes(n) ? only.filter((x) => x !== n) : [...only, n])
  // 勾了的实例游戏里已经没了（关卡切了、被销毁）：照样列出来、标灰，免得以为勾的还在
  const gone = only.filter((n) => !list.some((c) => c.name === n))
  return (
    <div className="ue:flex ue:shrink-0 ue:flex-wrap ue:items-center ue:gap-1.5 ue:border-b ue:border-line ue:bg-hover/40 ue:px-4 ue:py-1.5">
      <span className="ue:text-caption ue:text-subtle">
        {only.length ? t('只对勾的 {n} 个生效', { n: only.length }) : t('命中多个：点一下只对它生效')}
      </span>
      {list.slice(0, 30).map((c) => {
        const on = only.includes(c.name)
        return (
          <button
            key={c.name}
            type="button"
            title={c.path ?? c.name}
            onClick={() => toggle(c.name)}
            className={cn(
              'ue:inline-flex ue:h-6 ue:max-w-56 ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded-(--c-badge-radius) ue:border ue:px-2 ue:font-mono ue:text-caption',
              on ? 'ue:border-accent ue:bg-sel ue:text-fg' : 'ue:border-line ue:bg-card ue:text-muted ue:hover:text-fg',
            )}
          >
            {on && <Check className="ue:h-3 ue:w-3 ue:shrink-0" />}
            <span className="ue:truncate">{c.name}</span>
          </button>
        )
      })}
      {gone.map((n) => (
        <button
          key={n}
          type="button"
          title={t('此刻没找到这个实例，点一下去掉')}
          onClick={() => toggle(n)}
          className="ue:inline-flex ue:h-6 ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded-(--c-badge-radius) ue:border ue:border-dashed ue:border-line ue:px-2 ue:font-mono ue:text-caption ue:text-subtle ue:line-through"
        >
          {n}
        </button>
      ))}
      {list.length > 30 && (
        <span className="ue:text-caption ue:text-subtle">{t('还有 {n} 个', { n: list.length - 30 })}</span>
      )}
      {only.length > 0 && (
        <ui.Button size="sm" variant="ghost" onClick={() => onOnly([])}>
          <X className="ue:h-3.5 ue:w-3.5" /> {t('不挑了')}
        </ui.Button>
      )}
    </div>
  )
}

/** 设置 →「控件样式」的样张 */
export function InstancePickSpecimen() {
  return (
    <InstancePick
      hit={{ count: 3, candidates: [{ name: 'BP_Npc_C_0' }, { name: 'BP_Npc_C_1' }, { name: 'BP_Npc_C_2' }] }}
      only={['BP_Npc_C_1']}
      onOnly={() => undefined}
    />
  )
}
