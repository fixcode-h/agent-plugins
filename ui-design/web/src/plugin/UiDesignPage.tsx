import { Suspense, lazy, useMemo } from 'react'
import { LayoutTemplate, Plus } from 'lucide-react'
import { t } from '@shared/i18n'
import { useData, useNav } from '@/lib/data'
import { DesignOwner } from '@/lib/design-store'
import { cn } from '@/lib/utils'
import { NAV_ROW, SIDEBAR_ROW_OFF, SIDEBAR_ROW_ON } from '@/components/ui/sidebar'
import { UiDesignList } from '@/components/layout/SidebarDesigns'
import { DesignNav, isSplit } from './nav'
import { uiDesignHost } from './host'

const DesignPage = lazy(() => import('@/pages/DesignPage').then((m) => ({ default: m.DesignPage })))

/**
 * UI 设计的整页（1.4.0 起是项目工具，和表格、UE 页一样从侧栏「项目工具」打开，盖住会话侧栏）：
 * 左边是自己的列表栏（回到项目的卡片、标题、新建设计、这个项目的 UI 项目和界面），贴着侧栏底色；
 * 右边是设计页：打开的设计自己分成几块面板，新建和项目主页套一块卡片底（和面板别的页面一样）。
 * project 是面板给的当前项目；旧面板不给时不分项目，所有 UI 项目都列出来
 */
export function UiDesignPage({ project = '' }: { project?: string }) {
  const { projects } = useData()
  // 依赖只看 id 列表：项目改名、改设置时不用让整个设计页重新筛一遍
  const ids = projects.map((p) => p.id).join('\n')
  const owner = useMemo(() => ({ owner: project, panel: ids ? ids.split('\n') : [] }), [project, ids])
  return (
    <DesignOwner.Provider value={owner}>
      <DesignNav>
        <div className="ud:flex ud:min-h-0 ud:min-w-0 ud:flex-1 ud:flex-col ud:md:flex-row">
          <aside
            aria-label={t('UI 设计')}
            className="ud:flex ud:max-h-[40%] ud:shrink-0 ud:flex-col ud:md:max-h-none ud:md:w-66"
          >
            <Head project={project} />
            <UiDesignList />
          </aside>
          <Main />
        </div>
      </DesignNav>
    </DesignOwner.Provider>
  )
}

function Head({ project }: { project: string }) {
  const { route, go } = useNav()
  const on = route.page === 'design' && (!route.id || route.id === 'new') && !route.sub
  // 从项目工具打开时盖住了会话侧栏：顶上放面板的「回到项目」卡片（和表格、UE 页一样），点一下回到项目对话。
  // 旧面板没有这个组件，照旧只有标题
  const Back = project ? uiDesignHost()?.ui.ProjectBackCard : undefined
  return (
    <>
      {Back && (
        <div className="ud:shrink-0 ud:px-2.5 ud:pt-2.5">
          <Back projectId={project} icon={LayoutTemplate} />
        </div>
      )}
      <div
        className={cn('ud:flex ud:shrink-0 ud:items-center ud:gap-2.5 ud:px-4', Back ? 'ud:h-12' : 'ud:h-14 ud:pt-1')}
      >
        {/* 有项目卡片时卡片上已经有图标，标题就不再放图标块 */}
        {!Back && (
          <span className="ud:grid ud:h-[26px] ud:w-[26px] ud:shrink-0 ud:place-items-center ud:rounded-lg ud:bg-run ud:text-on-primary">
            <LayoutTemplate className="ud:h-3.5 ud:w-3.5" strokeWidth={2.3} />
          </span>
        )}
        {/* 只是标题，不是下拉：面板去掉了设计类型的切换（和 Blender 模型设计页的标题一样） */}
        <span className="ud:min-w-0 ud:flex-1 ud:truncate ud:text-body ud:font-semibold ud:text-fg">
          {t('UI 设计')}
        </span>
      </div>
      <nav aria-label={t('UI 设计')} className="ud:mb-2 ud:flex ud:flex-col ud:gap-0.5 ud:px-2.5">
        <button
          type="button"
          aria-current={on ? 'page' : undefined}
          onClick={() => go({ page: 'design', id: 'new' })}
          // 行的外观用面板侧栏导航行的同一套类（面板样式表里有），和「新建任务」「新建聊天」看起来一样
          className={cn(NAV_ROW, on ? SIDEBAR_ROW_ON : SIDEBAR_ROW_OFF, 'ud:font-semibold ud:text-fg')}
        >
          <Plus className="ud:h-4 ud:w-4 ud:shrink-0" strokeWidth={2.2} />
          <span className="ud:truncate">{t('新建设计')}</span>
        </button>
      </nav>
    </>
  )
}

function Main() {
  const { route } = useNav()
  return (
    <div
      className={cn(
        'ud:flex ud:min-h-0 ud:min-w-0 ud:flex-1 ud:flex-col ud:md:flex-row ud:md:overflow-hidden',
        !isSplit(route.id) && 'ud:panel',
      )}
    >
      <Suspense fallback={null}>
        <DesignPage />
      </Suspense>
    </div>
  )
}
