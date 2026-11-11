import { api as panelApi, request as panelRequest } from '@panel/web/src/lib/api'
import type { Design, DesignJob } from '@shared/design'
import { designApi } from './api-design'

/**
 * 插件里的 `@/lib/api`：面板的接口照旧（从面板开放模块转出去），设计的接口换到插件自己的地址。
 * 设计代码原来调的是面板的 /api/designs/…，拆成插件后接口挂在 /api/plugins/ui-design/api/designs/… 下；
 * 浏览器扩展（/designs/browser）和风格库（/styles）还是面板的。
 */
export * from '@panel/web/src/lib/api'

export const PLUGIN_ID = 'ui-design'
const BASE = `/plugins/${PLUGIN_ID}/api`
const ours = (url: string) => url.startsWith('/designs') && !url.startsWith('/designs/browser')

export function request<T>(url: string, init?: RequestInit): Promise<T> {
  return panelRequest<T>(ours(url) ? BASE + url : url, init)
}

/** 设计连同正在进行的 AI 对话 / 生成图片 */
export type DesignFull = Design & { job: DesignJob | null }

/** 设计里图片文件的地址 */
export const designFileUrl = (id: string, file: string) =>
  file.startsWith('data:') ? file : `/api${BASE}/designs/${id}/files/${file}`
/** 导出下载的地址 */
export const designExportUrl = (id: string, format: 'zip' | 'json' | 'react') =>
  `/api${BASE}/designs/${id}/export?format=${format}`

export const api = { ...panelApi, ...designApi }
