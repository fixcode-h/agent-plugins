import { useMemo, type ReactNode } from 'react'
import { NavCtx, useNav, type Route } from '@/lib/data'

/** 设计模式的 id：地址 #/pdesign/ui/<设计 id 或 new / home>/<子位置> */
export const MODE = 'ui'

/**
 * 设计代码照旧按「面板的 design 页」读写地址（route.page === 'design'，id 是设计 id、'new' 或 'home'，sub 是 UI 项目 id）。
 * 拆成插件后它住在面板的 #/pdesign/ui/<id>/<sub> 下：这里把面板的导航换算一下再交给设计代码，
 * 设计代码里几十处 go({ page: 'design', … }) 和 route.page === 'design' 都不用改。
 */
export const toDesign = (r: Route): Route =>
  r.page === 'pdesign' && r.id === MODE ? { page: 'design', id: r.sub, sub: r.msg } : r
export const fromDesign = (r: Route): Route =>
  r.page === 'design' ? { page: 'pdesign', id: MODE, sub: r.id, msg: r.sub } : r

export function DesignNav({ children }: { children: ReactNode }) {
  const nav = useNav()
  const value = useMemo(() => ({ ...nav, route: toDesign(nav.route), go: (r: Route) => nav.go(fromDesign(r)) }), [nav])
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>
}
