import { LayoutTemplate } from 'lucide-react'
import { lazy, Suspense } from 'react'
import type { ActivateWeb } from '../../sdk/web.ts'
import { t } from '@shared/i18n'
import { PAGE } from './src/plugin/nav'

const UiDesignPage = lazy(() => import('./src/plugin/UiDesignPage').then((m) => ({ default: m.UiDesignPage })))
const CaptureHost = lazy(() => import('./src/components/design/CaptureHost').then((m) => ({ default: m.CaptureHost })))

/**
 * UI 设计插件的网页入口（面板插件接口 5，ADR 0059）：图标栏里的「UI 设计」整页（和 Blender 的模型设计一样，
 * 左边的项目列表自己画），以及无头浏览器截图用的独立页（#/pbare/ui-design/capture/<设计 id>）。
 * 文案在 activate 之后才取：面板先读好包里的英文再调这里。
 */
const activate: ActivateWeb = () => ({
  pages: [
    {
      id: PAGE,
      label: t('UI 设计'),
      icon: LayoutTemplate,
      // 整页自己分块：左边列表栏贴着侧栏底色，右边的卡片底由插件按位置决定（打开的设计自己分成几块）
      split: () => true,
      Page: () => (
        <Suspense fallback={null}>
          <UiDesignPage />
        </Suspense>
      ),
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
