import { CircleCheck, Clock, FileSpreadsheet, ListChecks, Star, TriangleAlert } from 'lucide-react'
import { t } from '@shared/i18n'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { middleEllipsis } from './table-tree'

/** 每组最多列几张：空白区放得下两三排卡片，再多回左边的文件树找 */
const MAX = 6

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dirName = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/**
 * 表格页没打开表时的空白区：「最近打开」「收藏」「有不合规的表」三组卡片，点一下就打开。
 * 最近和收藏按项目记在本机（use-table-marks）；不合规来自左边「检查」的上次结果，
 * 没查过时给一个「检查全部表格」的入口，不在这里自己去查（几千张表全查一遍要好几秒，不该打开页面就跑）
 */
export function TablesHome({
  recent,
  favs,
  problems,
  total,
  onOpen,
  onCheck,
}: {
  recent: string[]
  favs: string[]
  /** 上次检查每个文件的不合规数；null 是这次打开页面还没查过 */
  problems: Map<string, number> | null
  /** 表格目录里一共几张表 */
  total: number
  onOpen: (path: string) => void
  /** 切到左边的「检查」，查一遍全部表格 */
  onCheck: () => void
}) {
  const bad = problems
    ? [...problems].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    : []
  return (
    <div className="thin-scroll tb:flex tb:min-h-0 tb:flex-1 tb:justify-center tb:overflow-y-auto tb:px-6 tb:py-10">
      <div className="tb:flex tb:w-full tb:max-w-3xl tb:flex-col tb:gap-7">
        <header className="tb:flex tb:flex-col tb:gap-1">
          <h2 className="tb:text-subtitle tb:font-semibold tb:text-fg">{t('打开一张表')}</h2>
          <p className="tb:text-body tb:text-subtle">
            {t('从左边的 {n} 张表里选，或者点下面的卡片；可以同时开几张，在上面的页签里切换。', { n: total })}
          </p>
        </header>
        <Group icon={Clock} title={t('最近打开')} count={recent.length}>
          {recent.length ? (
            <Cards paths={recent.slice(0, MAX)} onOpen={onOpen} />
          ) : (
            <Quiet>{t('打开过的表会列在这里。')}</Quiet>
          )}
        </Group>
        <Group icon={Star} title={t('收藏')} count={favs.length}>
          {favs.length ? (
            <Cards paths={favs.slice(0, MAX)} onOpen={onOpen} star />
          ) : (
            <Quiet>{t('在左边文件树上右键一张表选「收藏」，常用的表就会出现在这里。')}</Quiet>
          )}
        </Group>
        <Group icon={TriangleAlert} title={t('有不合规的表')} count={bad.length} danger={bad.length > 0}>
          {!problems ? (
            <Card as="button" interactive padding="sm" onClick={onCheck} className="tb:flex tb:items-center tb:gap-3">
              <Icon icon={ListChecks} />
              <span className="tb:flex tb:min-w-0 tb:flex-col">
                <span className="tb:text-body tb:font-medium tb:text-fg">{t('检查全部表格')}</span>
                <span className="tb:text-footnote tb:text-subtle">
                  {t('按结构文件查一遍类型、枚举、引用、主键，查完在这里列出有问题的表')}
                </span>
              </span>
            </Card>
          ) : bad.length ? (
            <Cards paths={bad.slice(0, MAX).map(([p]) => p)} counts={problems} onOpen={onOpen} />
          ) : (
            <Quiet>
              <CircleCheck className="tb:h-3.5 tb:w-3.5 tb:text-success" />
              {t('上次检查没发现不合规的格子。')}
            </Quiet>
          )}
          {bad.length > MAX && (
            <button
              type="button"
              onClick={onCheck}
              className="tb:mt-2 tb:cursor-pointer tb:self-start tb:text-footnote tb:text-subtle tb:hover:text-fg"
            >
              {t('还有 {n} 张，去「检查」里看全部', { n: bad.length - MAX })}
            </button>
          )}
        </Group>
      </div>
    </div>
  )
}

function Group({
  icon: I,
  title,
  count,
  danger,
  children,
}: {
  icon: typeof Clock
  title: string
  count: number
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <section aria-label={title} className="tb:flex tb:flex-col tb:gap-2.5">
      <h3 className="tb:flex tb:items-center tb:gap-1.5 tb:text-footnote tb:font-medium tb:text-muted">
        <I className={cn('tb:h-3.5 tb:w-3.5', danger ? 'tb:text-danger' : 'tb:text-subtle')} />
        {title}
        {count > 0 && <span className="tb:font-normal tb:text-subtle tb:tabular-nums">{count}</span>}
      </h3>
      {children}
    </section>
  )
}

/** 一组表的卡片：图标 + 文件名 + 所在目录；不合规的组右边是处数，收藏组带星 */
function Cards({
  paths,
  counts,
  star,
  onOpen,
}: {
  paths: string[]
  counts?: Map<string, number>
  star?: boolean
  onOpen: (path: string) => void
}) {
  return (
    <div className="tb:grid tb:grid-cols-1 tb:gap-2 tb:sm:grid-cols-2 tb:lg:grid-cols-3">
      {paths.map((p) => {
        const n = counts?.get(p)
        return (
          <Card
            key={p}
            as="button"
            interactive
            padding="sm"
            title={p}
            onClick={() => onOpen(p)}
            className="tb:flex tb:min-w-0 tb:items-center tb:gap-3"
          >
            <Icon icon={FileSpreadsheet} danger={!!n} />
            <span className="tb:flex tb:min-w-0 tb:flex-1 tb:flex-col">
              <span className="tb:truncate tb:text-body tb:font-medium tb:text-fg">{middleEllipsis(baseName(p))}</span>
              <span className="tb:truncate tb:text-caption tb:text-subtle">{dirName(p) || t('表格目录根')}</span>
            </span>
            {!!n && (
              <span className="tb:shrink-0 tb:rounded-(--c-badge-radius) tb:bg-danger/10 tb:px-1.5 tb:text-caption tb:text-danger tb:tabular-nums">
                {t('{n} 处', { n })}
              </span>
            )}
            {star && <Star className="tb:h-3.5 tb:w-3.5 tb:shrink-0 tb:fill-current tb:text-warning" />}
          </Card>
        )
      })}
    </div>
  )
}

function Icon({ icon: I, danger }: { icon: typeof Clock; danger?: boolean }) {
  return (
    <span
      className={cn(
        'tb:grid tb:h-8 tb:w-8 tb:shrink-0 tb:place-items-center tb:rounded-lg',
        danger ? 'tb:bg-danger/10 tb:text-danger' : 'tb:bg-accent-soft tb:text-accent-text',
      )}
    >
      <I className="tb:h-4 tb:w-4" />
    </span>
  )
}

function Quiet({ children }: { children: React.ReactNode }) {
  return (
    <p className="tb:flex tb:items-center tb:gap-1.5 tb:rounded-(--c-row-radius) tb:bg-(--c-row-bg) tb:px-3 tb:py-2.5 tb:text-footnote tb:text-subtle">
      {children}
    </p>
  )
}
