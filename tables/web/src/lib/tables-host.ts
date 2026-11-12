import type { WebHost } from '../../../../sdk/web.ts'

/**
 * 面板交给插件的宿主（activate 时拿到）：表格页要用的推送通道（插件接口 7 的 host.events）从这里取。
 * 只在 activate 里设一次；面板没给（单测、组件示例）时为空，用的地方按没有推送处理
 */
let current: WebHost | undefined

export function setTablesHost(host: WebHost) {
  current = host
}

export const tablesHost = () => current
