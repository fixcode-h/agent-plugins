import { useState } from 'react'
import { ChevronRight, Clock, Star } from 'lucide-react'
import { t } from '@shared/i18n'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/ui/icon-button'

/**
 * 文件树上面的「收藏」「最近打开」：点一个直接打开。没有时整块不出现；
 * 两块各自能收起（收起状态不记，打开页面时默认展开收藏、收起最近）
 */
export function TableQuick({
  favs,
  recent,
  active,
  onOpen,
  onUnfav,
}: {
  favs: string[]
  recent: string[]
  active?: string
  onOpen: (path: string) => void
  onUnfav: (path: string) => void
}) {
  if (!favs.length && !recent.length) return null
  return (
    <div className="tb:flex tb:flex-col tb:gap-1 tb:border-b tb:pb-1.5 tb:mb-1.5">
      {favs.length > 0 && (
        <Group icon={Star} title={t('收藏')} paths={favs} active={active} onOpen={onOpen} onUnfav={onUnfav} open />
      )}
      {recent.length > 0 && <Group icon={Clock} title={t('最近打开')} paths={recent} active={active} onOpen={onOpen} />}
    </div>
  )
}

function Group({
  icon: Icon,
  title,
  paths,
  active,
  onOpen,
  onUnfav,
  open: init = false,
}: {
  icon: typeof Star
  title: string
  paths: string[]
  active?: string
  onOpen: (path: string) => void
  onUnfav?: (path: string) => void
  open?: boolean
}) {
  const [open, setOpen] = useState(init)
  return (
    <section aria-label={title}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="tb:flex tb:h-7 tb:w-full tb:cursor-pointer tb:items-center tb:gap-1.5 tb:rounded-(--c-row-radius) tb:px-2 tb:text-caption tb:text-subtle tb:hover:bg-hover"
      >
        <ChevronRight className={cn('tb:h-3 tb:w-3 tb:transition-transform', open && 'tb:rotate-90')} />
        <Icon className="tb:h-3.5 tb:w-3.5" />
        {title}
        <span className="tb:ml-auto">{paths.length}</span>
      </button>
      {open && (
        <div role="list" className="tb:flex tb:flex-col tb:gap-px">
          {paths.map((p) => (
            <div
              role="listitem"
              key={p}
              className={cn(
                'tb:group tb:flex tb:h-7 tb:items-center tb:rounded-(--c-row-radius) tb:pr-1 tb:pl-7 tb:hover:bg-hover',
                p === active && 'tb:bg-sel tb:font-medium tb:hover:bg-sel',
              )}
            >
              <button
                type="button"
                title={p}
                onClick={() => onOpen(p)}
                className="tb:min-w-0 tb:flex-1 tb:cursor-pointer tb:truncate tb:text-left tb:text-body"
              >
                {p.slice(p.lastIndexOf('/') + 1)}
              </button>
              {onUnfav && (
                <IconButton
                  icon={Star}
                  label={t('取消收藏')}
                  onClick={() => onUnfav(p)}
                  className="tb:h-6 tb:w-6 tb:opacity-0 tb:group-hover:opacity-100 tb:focus-visible:opacity-100"
                />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
