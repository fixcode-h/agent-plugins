import { Check, Ellipsis, Link2, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { h, t } from '../../../host.ts'
import { Badge } from '../../../ui.tsx'
import { isStale, satisfies, type CardTone, type PluginView, type StateKey } from './model.ts'

/**
 * UE 插件页的一张插件卡片（设计稿 designs/UE插件管理页重设计-设计稿.md）：头上名字、类型和一个状态徽标，
 * 中间两行说明 + 字段表（版本、编辑器里加载的版本、实测引擎、依赖、可选插件、Agent 工具、安装方式），底栏放动作。
 * 只管怎么画，数据和动作由 Plugins.tsx 给；设置 →「组件」的示例也用它。
 */
const STATE_LABEL: Record<StateKey, () => string> = {
  running: () => t('升级中'),
  queued: () => t('排队中'),
  unpublished: () => t('没有发布的版本'),
  blocked: () => t('装不了'),
  missing: () => t('未安装'),
  broken: () => t('安装不完整'),
  upgrade: () => t('可升级'),
  stale: () => t('编辑器里是旧版'),
  latest: () => t('已是最新'),
}

/** 实测引擎的小块：项目当前版本高亮打勾，没实测过的变淡 */
function EngineChips({ tested, current, min }: { tested: string[]; current?: string; min?: string }) {
  const { cn } = h()
  const cur = current?.split('.').slice(0, 2).join('.')
  const all = [...new Set(['5.4', '5.5', '5.6', '5.7', '5.8', ...tested, ...(cur ? [cur] : [])])].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  )
  return (
    <>
      {all.map((v) => {
        const isCur = v === cur
        const ok = tested.includes(v)
        const tooOld = !!min && v.localeCompare(min, undefined, { numeric: true }) < 0
        return (
          <span
            key={v}
            title={
              isCur
                ? t('这个项目的引擎')
                : ok
                  ? t('实测过')
                  : tooOld
                    ? t('低于最低版本 {v}', { v: min! })
                    : t('没实测过')
            }
            className={cn(
              'ue:inline-flex ue:h-[18px] ue:items-center ue:gap-0.5 ue:rounded-sm ue:px-1 ue:font-mono ue:text-caption',
              isCur && ok
                ? 'ue:bg-success/14 ue:font-semibold ue:text-success'
                : isCur
                  ? 'ue:bg-warning/14 ue:font-semibold ue:text-warning'
                  : ok
                    ? 'ue:bg-hover ue:text-fg'
                    : tooOld
                      ? 'ue:text-subtle ue:line-through ue:opacity-60'
                      : 'ue:bg-hover/60 ue:text-subtle',
            )}
          >
            {isCur && ok && <Check className="ue:h-2.5 ue:w-2.5" strokeWidth={3} />}
            {v}
          </span>
        )
      })}
    </>
  )
}

const Ok = () => <Check className="ue:h-3 ue:w-3 ue:text-success" strokeWidth={2.5} />
const Code = ({ children }: { children: ReactNode }) => (
  <span className="ue:rounded-sm ue:bg-hover ue:px-1 ue:font-mono ue:text-caption ue:text-fg">{children}</span>
)
const Ver = ({ children, tone }: { children: ReactNode; tone?: string }) => (
  <span className={h().cn('ue:font-mono', tone)}>{children}</span>
)
const Sub = ({ children }: { children: ReactNode }) => <span className="ue:text-subtle">{children}</span>

/** 字段表的行：没内容的行不画 */
function rows(v: PluginView, engine: string | undefined, linkVersion: string | undefined) {
  const out: [string, ReactNode][] = []
  const pre = v.offer?.prerelease && <Badge tone="run">{t('预发布')}</Badge>
  if (v.installed)
    out.push([
      t('版本'),
      v.upgrade ? (
        <>
          <Ver>{v.installed.version}</Ver>
          <Sub>→</Sub>
          <Ver tone="ue:text-warning">{v.offer!.version}</Ver>
          {pre}
        </>
      ) : (
        <>
          <Ver>{v.installed.version}</Ver>
          {/-/.test(v.installed.version) && <Badge tone="run">{t('预发布')}</Badge>}
        </>
      ),
    ])
  else
    out.push([
      t('可装版本'),
      v.offer ? (
        <>
          <Ver>{v.offer.version}</Ver>
          {pre}
        </>
      ) : (
        <Sub>{t('插件目录里还没有发布的版本')}</Sub>
      ),
    ])
  if (v.installed)
    out.push([
      t('编辑器里'),
      !v.loaded ? (
        <Sub>{t('编辑器没开，或连不上')}</Sub>
      ) : isStale(v) ? (
        <>
          <Ver tone="ue:text-warning">{v.loaded}</Ver>
          <Sub>{t('· 编译后重启编辑器生效')}</Sub>
        </>
      ) : (
        <>
          <Ver>{v.loaded}</Ver>
          <Sub>{t('· 和装的一致')}</Sub>
        </>
      ),
    ])
  if (v.info)
    out.push([t('实测引擎'), <EngineChips tested={v.info.engineTested} current={engine} min={v.info.engineMin} />])
  const req = Object.entries(v.info?.requires ?? {})
  if (req.length)
    out.push([
      t('依赖'),
      req.map(([name, range]) => {
        const ok = name !== 'UELink' || satisfies(linkVersion, range)
        return (
          <span key={name} className="ue:inline-flex ue:items-center ue:gap-1">
            {name} {range.replace(/^>=\s*/, '≥ ')}
            {ok ? (
              <Ok />
            ) : v.withUELink ? (
              <>
                <TriangleAlert className="ue:h-3 ue:w-3 ue:text-warning" />
                <span className="ue:text-warning">{t('装时一起升级')}</span>
              </>
            ) : (
              <X className="ue:h-3 ue:w-3 ue:text-danger" strokeWidth={2.5} />
            )}
          </span>
        )
      }),
    ])
  if (v.base) out.push([t('被依赖'), v.requiredBy.length ? v.requiredBy.join('、') : <Sub>{t('还没有装扩展')}</Sub>])
  if (v.info?.optional.length)
    out.push([
      t('可选'),
      v.info.optional.map((o, i) => (
        <span key={o.name} className="ue:inline-flex ue:items-center ue:gap-1">
          {i > 0 && <Sub>·</Sub>}
          {o.name}
          {o.on ? <Ok /> : <Sub>{t('没开')}</Sub>}
        </span>
      )),
    ])
  const tools = v.info?.tools ?? []
  if (tools.length)
    out.push([
      'Agent',
      tools.length > 3 ? (
        <span title={tools.join('、')} className="ue:inline-flex ue:items-center ue:gap-1">
          <Code>{`${tools[0].split('_')[0]}_*`}</Code>
          <Sub>{t('{n} 个工具', { n: tools.length })}</Sub>
        </span>
      ) : (
        tools.map((x) => <Code key={x}>{x}</Code>)
      ),
    ])
  if (v.installed)
    out.push([
      t('安装方式'),
      <>
        {v.installed.mode === 'vcs' ? t('已加入版本管理') : t('只在本机')}
        <Sub>· {v.installed.rel.replace(/\\/g, '/')}</Sub>
      </>,
    ])
  return out
}

export function PluginCard({
  view,
  icon: Icon,
  state,
  engine,
  linkVersion,
  extra,
  footer,
  aside,
  onMore,
}: {
  view: PluginView
  icon: LucideIcon
  state: { tone: CardTone; key: StateKey }
  /** 项目引擎版本（高亮实测引擎里的那一格） */
  engine?: string
  /** 项目里 UELink 的版本（看依赖满不满足） */
  linkVersion?: string
  /** 字段表下面的东西：升级进度、拦住的原因 */
  extra?: ReactNode
  footer: ReactNode
  /** 底栏靠右的次要按钮（更新说明） */
  aside?: ReactNode
  onMore?: (e: MouseEvent) => void
}) {
  const { cn, ui } = h()
  const off = !view.installed
  return (
    <section
      className={cn(
        'ue:flex ue:min-w-0 ue:flex-col ue:bg-card',
        view.base && 'ue:shadow-[inset_0_2px_0_var(--color-accent)]',
      )}
    >
      <header className="ue:flex ue:items-center ue:gap-2.5 ue:px-4 ue:pt-3.5 ue:pb-2">
        <span
          className={cn(
            'ue:flex ue:h-8 ue:w-8 ue:shrink-0 ue:items-center ue:justify-center ue:rounded-lg',
            off ? 'ue:bg-hover ue:text-muted' : 'ue:bg-accent-soft ue:text-accent-text',
          )}
        >
          <Icon className="ue:h-4 ue:w-4" strokeWidth={1.75} />
        </span>
        <div className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col">
          <span className="ue:truncate ue:text-heading ue:font-medium ue:text-fg">{view.displayName}</span>
          <span className="ue:inline-flex ue:items-center ue:gap-1 ue:truncate ue:text-caption ue:text-subtle">
            {view.base ? (
              t('基础插件 · 其他插件都挂在它上面')
            ) : (
              <>
                <Link2 className="ue:h-3 ue:w-3" /> {t('扩展 · 挂在 UELink 上')}
              </>
            )}
          </span>
        </div>
        <Badge tone={state.tone}>{STATE_LABEL[state.key]()}</Badge>
      </header>
      <p
        title={view.description}
        className="ue:mx-4 ue:mb-2.5 ue:line-clamp-2 ue:min-h-[2lh] ue:text-body ue:leading-relaxed ue:text-muted"
      >
        {view.description}
      </p>
      <div className="ue:grid ue:flex-1 ue:grid-cols-[4.5rem_minmax(0,1fr)] ue:content-start ue:gap-x-2.5 ue:gap-y-1.5 ue:border-t ue:border-line ue:px-4 ue:py-2.5 ue:text-footnote">
        {rows(view, engine, linkVersion).map(([k, val]) => (
          <div key={k} className="ue:contents">
            <span className="ue:pt-px ue:text-subtle">{k}</span>
            <span className="ue:flex ue:min-w-0 ue:flex-wrap ue:items-center ue:gap-1 ue:text-fg">{val}</span>
          </div>
        ))}
      </div>
      {extra}
      <footer className="ue:flex ue:min-h-11 ue:items-center ue:gap-1.5 ue:border-t ue:border-line ue:px-3 ue:py-2">
        {footer}
        <span className="ue:flex-1" />
        {aside}
        {onMore && <ui.IconButton icon={Ellipsis} size="sm" label={t('更多')} onClick={onMore} />}
      </footer>
    </section>
  )
}
