import { CircleHelp, Plus, type LucideIcon } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { h, t } from './host.ts'

/**
 * 插件设置页的共用排版，照面板「设置」窗口画（web/src/components/settings/parts.tsx 的 Group / Row 和 index.css 的 .settings-card）：
 * 内容在居中的一栏里；每组的组名是卡片外面的一行小字，内容放在一张浅底卡片里，行与行之间一道细线；
 * 每行左边标题和一行短说明（长的写进标题旁的问号），右边是定宽 280px 的控件栏。
 * 用户 2026-11-18：「插件设置页面就很乱，参考软件设置页面」——之前是贴边的卡片 + 卡片头，和面板设置窗口两套样子。
 * 主题色、圆角都用面板的变量（--panel-radius 跟着外观设置走），不自造配色。
 * 用户 2026-11-18 又要「做成分页，左边加个菜单列」：SettingsLayout 左边一列菜单（照面板设置窗口的侧栏），右边只画选中的那一组；
 * 组靠 SettingGroup 的 page 认，不在当前页的组不画。弹窗里没有菜单（不给 PageContext），所有组照常一起画。
 */

/** 当前显示哪一页：SettingsLayout 提供；没有时（弹窗里）所有组都画 */
const PageContext = createContext<string | undefined>(undefined)

/** 当前页是不是这几页之一（运行设置的保存栏只在它那几页出现）；不分页时总是 true */
export function useSettingsPage(pages: readonly string[]) {
  const cur = useContext(PageContext)
  return cur === undefined || pages.includes(cur)
}

export interface SettingsNavItem {
  id: string
  label: string
  icon?: LucideIcon
}
export interface SettingsNavSection {
  title?: string
  items: SettingsNavItem[]
}

/**
 * 分页的设置页：左边菜单列（分节小标题 + 一项一页），右边滚动区画当前页。
 * 菜单样式照面板设置窗口的侧栏：选中项浅底、图标 + 文字；窄屏时菜单变成顶上一排可横向滚动的按钮
 */
export function SettingsLayout({
  nav,
  current,
  onPick,
  children,
}: {
  nav: SettingsNavSection[]
  current: string
  onPick: (id: string) => void
  children: ReactNode
}) {
  const { cn } = h()
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:md:flex-row">
      <nav
        aria-label={t('设置分页')}
        className="ue:flex ue:shrink-0 ue:gap-1 ue:overflow-x-auto ue:border-b ue:border-line ue:px-3 ue:py-2 ue:md:w-56 ue:md:flex-col ue:md:gap-0 ue:md:overflow-y-auto ue:md:border-r ue:md:border-b-0 ue:md:py-3"
      >
        {nav.map((sec, i) => (
          <div key={sec.title ?? i} className="ue:flex ue:shrink-0 ue:gap-1 ue:md:flex-col ue:md:gap-0.5 ue:md:pb-3">
            {sec.title && (
              <span className="ue:hidden ue:px-2.5 ue:pt-1 ue:pb-1.5 ue:text-footnote ue:text-subtle ue:md:block">
                {sec.title}
              </span>
            )}
            {sec.items.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={id === current ? 'page' : undefined}
                onClick={() => onPick(id)}
                className={cn(
                  'ue:flex ue:h-8 ue:shrink-0 ue:items-center ue:gap-2.5 ue:rounded-(--c-row-radius) ue:px-2.5 ue:text-left ue:text-body ue:whitespace-nowrap ue:transition-colors',
                  id === current ? 'ue:bg-fg/8 ue:text-fg' : 'ue:text-muted ue:hover:bg-fg/5 ue:hover:text-fg',
                )}
              >
                {Icon && <Icon className="ue:h-4 ue:w-4 ue:shrink-0" />}
                <span className="ue:min-w-0 ue:truncate">{label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      {/* 换页不重新挂载内容：表单（运行设置）在几页之间共用一份没保存的改动 */}
      <PageContext.Provider value={current}>
        <SettingsPage scrollKey={current}>{children}</SettingsPage>
      </PageContext.Provider>
    </div>
  )
}

/** 设置页的滚动区：居中的一栏，宽度和面板设置窗口的内容区差不多 */
export function SettingsPage({ children, scrollKey }: { children: ReactNode; scrollKey?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  // 换页回到顶上（分页时）
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 })
  }, [scrollKey])
  return (
    <div ref={ref} className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
      <div className="ue:mx-auto ue:flex ue:w-full ue:max-w-[960px] ue:flex-col ue:px-6 ue:pb-10">{children}</div>
    </div>
  )
}

/** 标题旁的问号：悬停或聚焦时显示详细说明（边界情况、原理、需要哪个版本） */
export function HelpTip({ children }: { children: ReactNode }) {
  return (
    <span className="ue:group/tip ue:relative ue:inline-flex ue:items-center">
      <button
        type="button"
        aria-label={t('说明')}
        className="ue:inline-flex ue:cursor-help ue:text-subtle ue:transition-colors ue:hover:text-fg ue:focus-visible:text-fg ue:focus-visible:outline-none"
      >
        <CircleHelp className="ue:h-3.5 ue:w-3.5" />
      </button>
      <span
        role="tooltip"
        className="ue:pointer-events-none ue:invisible ue:absolute ue:top-full ue:left-1/2 ue:z-30 ue:mt-1.5 ue:w-72 ue:-translate-x-1/2 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:px-3 ue:py-2 ue:text-footnote ue:leading-relaxed ue:font-normal ue:text-muted ue:opacity-0 ue:shadow-lg ue:transition-opacity ue:group-hover/tip:visible ue:group-hover/tip:opacity-100 ue:group-focus-within/tip:visible ue:group-focus-within/tip:opacity-100"
      >
        {children}
      </span>
    </span>
  )
}

/** 卡片底色：和面板 .settings-card 一样是前景色 3.5% 叠在背景上 */
const CARD = 'ue:flex ue:flex-col ue:rounded-(--panel-radius,0) ue:bg-fg/[3.5%]'
/** 卡片里两段内容之间的细线 */
const DIVIDE = 'ue:[&>*+*]:border-t ue:[&>*+*]:border-line/80'

/**
 * 一组设置：组名在卡片外（小字），右边可放说明小字（aside）和按钮（action）；desc 是卡片里第一段的一句说明。
 * flush：内容自己带左右边距（面板画的插件参数表单），卡片不再加
 * page：属于分页设置页的哪一页；不是当前页时不画
 */
export function SettingGroup({
  title,
  aside,
  action,
  desc,
  hint,
  children,
  flush,
  page,
}: {
  title: ReactNode
  page?: string
  /** 组名旁问号里的详细说明 */
  hint?: ReactNode
  aside?: ReactNode
  action?: ReactNode
  desc?: ReactNode
  children: ReactNode
  flush?: boolean
}) {
  const { cn } = h()
  const cur = useContext(PageContext)
  if (cur !== undefined && page !== undefined && page !== cur) return null
  return (
    <section className="ue:flex ue:flex-col ue:pt-6 ue:first:pt-4">
      <h3 className="ue:flex ue:min-h-7 ue:items-center ue:gap-2 ue:pb-2 ue:pl-1 ue:text-footnote ue:font-semibold ue:tracking-wide ue:text-subtle">
        <span>{title}</span>
        {hint && <HelpTip>{hint}</HelpTip>}
        {aside && (
          <span className="ue:ml-auto ue:min-w-0 ue:truncate ue:font-normal ue:tracking-normal ue:text-subtle/80">
            {aside}
          </span>
        )}
        {action && <span className={h().cn('ue:flex ue:items-center ue:gap-1', !aside && 'ue:ml-auto')}>{action}</span>}
      </h3>
      <div className={cn(CARD, DIVIDE, !flush && 'ue:px-4')}>
        {desc && <p className="ue:py-3.5 ue:text-body ue:leading-relaxed ue:text-subtle">{desc}</p>}
        {children}
      </div>
    </section>
  )
}

/**
 * 一个设置项：左边标题和一行短说明，hint 挂在标题旁的问号上；右边控件栏定宽 280px。
 * stack：控件太宽（多行文本、路径）时放到说明下面占满整行
 */
export function SettingRow({
  title,
  desc,
  hint,
  children,
  stack,
}: {
  title: ReactNode
  desc?: ReactNode
  hint?: ReactNode
  children?: ReactNode
  stack?: boolean
}) {
  const { cn } = h()
  return (
    <div
      className={cn(
        'ue:flex ue:flex-col ue:gap-3 ue:py-3.5',
        !stack && 'ue:sm:min-h-14 ue:sm:flex-row ue:sm:items-center ue:sm:justify-between ue:sm:gap-8',
      )}
    >
      <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-0.5">
        <span className="ue:flex ue:flex-wrap ue:items-center ue:gap-1.5 ue:text-prose ue:font-medium ue:text-fg">
          {title}
          {hint && <HelpTip>{hint}</HelpTip>}
        </span>
        {desc && <span className="ue:text-body ue:leading-relaxed ue:text-subtle">{desc}</span>}
      </div>
      {children !== undefined && (
        <div className={cn('ue:min-w-0', !stack && 'ue:sm:w-[280px] ue:sm:shrink-0')}>{children}</div>
      )}
    </div>
  )
}

/** 一组里的规则列表（条目怎么认、阻挡界面）：每条一个小框，没有时一行虚线占位 */
export function SettingList({ count, children }: { count: number; children: ReactNode }) {
  return (
    <div className="ue:flex ue:flex-col ue:gap-2 ue:py-3.5">
      {!count && (
        <p className="ue:rounded-(--c-row-radius) ue:border ue:border-dashed ue:border-line ue:px-3 ue:py-4 ue:text-center ue:text-footnote ue:text-subtle">
          {t('还没有规则')}
        </p>
      )}
      {children}
    </div>
  )
}

/** 组名右边的「添加」 */
export function AddButton({ onClick }: { onClick: () => void }) {
  const { ui } = h()
  return (
    <ui.Button size="sm" variant="ghost" onClick={onClick}>
      <Plus className="ue:h-3.5 ue:w-3.5" /> {t('添加')}
    </ui.Button>
  )
}
