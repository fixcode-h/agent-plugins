import { LayoutTemplate } from 'lucide-react'
import { lazy, Suspense } from 'react'
import type { ActivateWeb } from '../../sdk/web.ts'
import { t } from '@shared/i18n'
import { DesignNav, MODE } from './src/plugin/nav'
import { UiDesignList } from './src/components/layout/SidebarDesigns'

const DesignPage = lazy(() => import('./src/pages/DesignPage').then((m) => ({ default: m.DesignPage })))
const CaptureHost = lazy(() => import('./src/components/design/CaptureHost').then((m) => ({ default: m.CaptureHost })))

/**
 * UI 设计插件的网页入口（面板插件接口 4，ADR 0059）：设计模式下拉里的「UI 设计」（自带侧栏和整页），
 * 以及无头浏览器截图用的独立页（#/pbare/ui-design/capture/<设计 id>）。
 * 文案在 activate 之后才取：面板先读好包里的英文再调这里。
 */
const activate: ActivateWeb = () => ({
  designModes: [
    {
      id: MODE,
      name: t('UI 设计'),
      desc: t('界面 · 原画 · 切图'),
      icon: LayoutTemplate,
      tone: 'bg-run',
      empty: t('还没有 UI 项目。UI 设计的项目和 Agent 的项目是分开的。'),
      newLabel: t('新建设计'),
      Sidebar: () => (
        <DesignNav>
          <UiDesignList />
        </DesignNav>
      ),
      Page: () => (
        <DesignNav>
          <Suspense fallback={null}>
            <DesignPage />
          </Suspense>
        </DesignNav>
      ),
      // 打开的设计分成对话 / 画板 / 检查器几块；新建和项目主页还是一整块
      split: (id) => !!id && id !== 'new' && id !== 'home',
    },
  ],
  barePages: [
    {
      id: 'capture',
      Page: ({ path }) => (
        <Suspense fallback={null}>
          <CaptureHost id={path} />
        </Suspense>
      ),
    },
  ],
})

export default activate
