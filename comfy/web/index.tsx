import { lazy, Suspense } from 'react'
import type { ActivateWeb } from '../../sdk/web.ts'
import { t } from '@shared/i18n'
import { ComfyIcon } from '@/components/layout/rail-icons'

// 整页带着节点图画布（@xyflow/react）和模板商店：第一次打开时才执行
const ComfyPage = lazy(() => import('./src/pages/ComfyPage').then((m) => ({ default: m.ComfyPage })))

/**
 * ComfyUI 工作流插件的网页入口（面板插件接口 10，ADR 0059；原来是面板自带的 ComfyUI 工作流页，复查报告 C3）。
 * 只有页面搬了过来：工作流列表、节点图、模板商店、工作流链。生图服务（装 ComfyUI、下模型、跑工作流的接口
 * /api/local-image）和设置里的「本机生图」还在面板：UI 设计、视频截帧插件也在用，不依赖这个插件。
 * 文案在 activate 之后才取：面板先读好包里的英文再调这里。
 */
const activate: ActivateWeb = () => ({
  pages: [
    {
      id: 'comfy',
      label: t('ComfyUI 工作流'),
      icon: ComfyIcon,
      Page: ({ path }) => (
        <Suspense fallback={null}>
          <ComfyPage path={path} />
        </Suspense>
      ),
    },
  ],
})

export default activate
