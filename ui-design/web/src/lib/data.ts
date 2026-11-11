import type { Context, ContextType } from 'react'
import * as panel from '@panel/web/src/lib/data'

/**
 * 面板的 web/src/lib/data 原样转出，只把导航的类型放宽：设计代码照旧按「design 页」读写地址
 * （go({ page: 'design', … })、route.page === 'design'），面板拆掉自带的 UI 设计后 PageId 里没有 'design' 了。
 * 运行时的地址由 web/src/plugin/nav.tsx 的 DesignNav 换算成面板的 #/pdesign/ui/…，这里只管类型。
 */
export * from '@panel/web/src/lib/data'

export type PageId = panel.PageId | 'design'
export type Route = Omit<panel.Route, 'page'> & { page: PageId }
type Nav = Omit<ContextType<typeof panel.NavCtx>, 'route' | 'go'> & { route: Route; go: (r: Route) => void }
export const NavCtx = panel.NavCtx as unknown as Context<Nav>
export const useNav = panel.useNav as () => Nav
