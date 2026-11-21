import { Boxes, CodeXml, Monitor, type LucideIcon } from 'lucide-react'
import { h, t } from '../../../../host.ts'
import { SOURCES, type Source } from './data.ts'

const META: Record<Source, { icon: LucideIcon; label: () => string }> = {
  screen: { icon: Monitor, label: () => t('屏上界面') },
  world: { icon: Boxes, label: () => t('关卡 Actor') },
  lua: { icon: CodeXml, label: () => t('Lua 对象') },
}

/**
 * 在哪找：三个开关，可多选也可都不选（都不选 = 这个类的全部实例，存成 in: "all"）。
 * 数字是此刻这个来源里这个类有几个（游戏开着时）；和类对不上的置灰、不能点
 */
export function SourceChips({
  value,
  onChange,
  allowed,
  counts,
}: {
  value: Source[]
  onChange: (v: Source[]) => void
  allowed: Source[]
  counts: Partial<Record<Source, number>>
}) {
  const { cn } = h()
  return (
    <div className="ue:flex ue:flex-wrap ue:gap-1.5" role="group" aria-label={t('在哪找')}>
      {SOURCES.map((s) => {
        const { icon: Icon, label } = META[s]
        const on = value.includes(s)
        const ok = allowed.includes(s)
        const n = counts[s]
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            disabled={!ok}
            title={ok ? undefined : t('这个类在这里找不到')}
            onClick={() =>
              onChange(on ? value.filter((x) => x !== s) : SOURCES.filter((x) => x === s || value.includes(x)))
            }
            className={cn(
              'ue:flex ue:h-8 ue:items-center ue:gap-1.5 ue:rounded-(--c-input-radius) ue:border ue:px-2.5 ue:text-footnote ue:transition-colors',
              on
                ? 'ue:border-accent ue:bg-accent/10 ue:text-fg'
                : 'ue:border-line-strong ue:bg-field ue:text-muted ue:hover:text-fg',
              ok ? 'ue:cursor-pointer' : 'ue:cursor-not-allowed ue:border-dashed ue:opacity-45',
            )}
          >
            <Icon className="ue:h-3.5 ue:w-3.5" />
            {label()}
            {n !== undefined && (
              <span
                className={cn(
                  'ue:rounded-full ue:px-1.5 ue:text-caption',
                  on ? 'ue:bg-accent ue:text-on-accent' : 'ue:bg-hover ue:text-subtle',
                )}
              >
                {n}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
