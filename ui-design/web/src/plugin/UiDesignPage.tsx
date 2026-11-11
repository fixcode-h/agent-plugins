import { Suspense, lazy } from 'react'
import { LayoutTemplate, Plus } from 'lucide-react'
import { t } from '@shared/i18n'
import { useNav } from '@/lib/data'
import { cn } from '@/lib/utils'
import { NAV_ROW, SIDEBAR_ROW_OFF, SIDEBAR_ROW_ON } from '@/components/ui/sidebar'
import { UiDesignList } from '@/components/layout/SidebarDesigns'
import { DesignNav, isSplit } from './nav'

const DesignPage = lazy(() => import('@/pages/DesignPage').then((m) => ({ default: m.DesignPage })))

/**
 * UI 设计的整页（图标栏里的入口，和 Blender 的模型设计一样；面板插件接口 5 去掉了设计模式）：
 * 左边是自己的列表栏（标题、新建设计、UI 项目和界面），占的是面板会话侧栏让出来的位置，贴着侧栏底色；
 * 右边是设计页：打开的设计自己分成几块面板，新建和项目主页套一块卡片底（和面板别的页面一样）。
 */
export function UiDesignPage() {
  return (
    <DesignNav>
      <div className="ud:flex ud:min-h-0 ud:min-w-0 ud:flex-1 ud:flex-col ud:md:flex-row">
        <aside
          aria-label={t('UI 设计')}
          className="ud:flex ud:max-h-[40%] ud:shrink-0 ud:flex-col ud:md:max-h-none ud:md:w-66"
        >
          <Head />
          <UiDesignList />
        </aside>
        <Main />
      </div>
    </DesignNav>
  )
}

function Head() {
  const { route, go } = useNav()
  const on = route.page === 'design' && (!route.id || route.id === 'new') && !route.sub
  return (
    <>
      <div className="ud:flex ud:h-14 ud:shrink-0 ud:items-center ud:gap-2.5 ud:px-4 ud:pt-1">
        <span className="ud:grid ud:h-[26px] ud:w-[26px] ud:shrink-0 ud:place-items-center ud:rounded-lg ud:bg-run ud:text-on-primary">
          <LayoutTemplate className="ud:h-3.5 ud:w-3.5" strokeWidth={2.3} />
        </span>
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
