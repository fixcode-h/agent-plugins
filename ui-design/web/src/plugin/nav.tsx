import { useMemo, type ReactNode } from 'react'
import { NavCtx, useNav, type Route } from '@/lib/data'

/** 插件 id 和整页 id：地址 #/plugin/ui-design/ui/<设计 id 或 new / home>/<子位置> */
export const PLUGIN = 'ui-design'
export const PAGE = 'ui'

/**
 * 设计代码照旧按「面板的 design 页」读写地址（route.page === 'design'，id 是设计 id、'new' 或 'home'，sub 是 UI 项目 id）。
 * 拆成插件后它住在面板图标栏的整页 #/plugin/ui-design/ui/<id>/<sub> 下（插件接口 5，子位置可以带 /）：
 * 这里把面板的导航换算一下再交给设计代码，设计代码里几十处 go({ page: 'design', … }) 和 route.page === 'design' 都不用改。
 */
export const toDesign = (r: Route): Route => {
  if (r.page !== 'plugin' || r.id !== PLUGIN || r.sub !== PAGE) return r
  const [id, ...rest] = (r.msg ?? '').split('/')
  return { page: 'design', id: id || undefined, sub: rest.join('/') || undefined }
}
export const fromDesign = (r: Route): Route =>
  r.page === 'design'
    ? { page: 'plugin', id: PLUGIN, sub: PAGE, msg: [r.id, r.sub].filter(Boolean).join('/') || undefined }
    : r

/** 打开的设计分成对话 / 画板 / 检查器几块；新建和项目主页还是一整块（套卡片底） */
export const isSplit = (id?: string) => !!id && id !== 'new' && id !== 'home'

export function DesignNav({ children }: { children: ReactNode }) {
  const nav = useNav()
  const value = useMemo(() => ({ ...nav, route: toDesign(nav.route), go: (r: Route) => nav.go(fromDesign(r)) }), [nav])
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>
}
