import type { Route } from '@/lib/data'

/** 插件 id 和整页 id：地址 #/plugin/comfy/comfy/<game|web>/<工作流 id> */
export const PLUGIN = 'comfy'
export const PAGE = 'comfy'

/** Comfy 页的地址（原来面板自带的 #/comfy/<分类>/<工作流> 由面板转到这里） */
export const comfyRoute = (kind?: string, workflowId?: string): Route => ({
  page: 'plugin',
  id: PLUGIN,
  sub: PAGE,
  msg: [kind, workflowId].filter(Boolean).join('/') || undefined,
})
