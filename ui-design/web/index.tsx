import { LayoutTemplate } from 'lucide-react'
import { lazy, Suspense } from 'react'
import type { ActivateWeb, WebPlugin } from '../../sdk/web.ts'
import { t } from '@shared/i18n'
import { PAGE } from './src/plugin/nav'
import { setUiDesignHost } from './src/plugin/host'

const UiDesignPage = lazy(() => import('./src/plugin/UiDesignPage').then((m) => ({ default: m.UiDesignPage })))
const CaptureHost = lazy(() => import('./src/components/design/CaptureHost').then((m) => ({ default: m.CaptureHost })))

/**
 * UI 设计插件的网页入口（面板插件接口 5，ADR 0059）：「UI 设计」整页，以及无头浏览器截图用的独立页（#/pbare/ui-design/capture/<设计 id>）。
 * 1.4.0 起按项目启用（插件接口 9，和表格、UE 一样）：整页进侧栏的「项目工具」，打开时盖住会话侧栏，
 * 左栏顶上的项目卡片点一下回到项目对话；左栏只列这个项目的 UI 项目和设计。
 * 文案在 activate 之后才取：面板先读好包里的英文再调这里。
 */
const activate: ActivateWeb = (host) => {
  setUiDesignHost(host)
  return plugin()
}

const plugin = (): WebPlugin => ({
  pages: [
    {
      id: PAGE,
      label: t('UI 设计'),
      icon: LayoutTemplate,
      // 按项目生效：页面进侧栏的「项目工具」，面板给出当前项目；打开时盖住会话侧栏（和表格、UE 页一样）
      scope: 'project',
      cover: true,
      // 整页自己分块：左边列表栏贴着侧栏底色，右边的卡片底由插件按位置决定（打开的设计自己分成几块）
      split: () => true,
      Page: ({ project }) => (
        <Suspense fallback={null}>
          <UiDesignPage project={project} />
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
