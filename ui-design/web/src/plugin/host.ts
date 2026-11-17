import type { WebHost } from '../../../../sdk/web.ts'

/**
 * 面板交给插件的 host（activate 时记下）：整页顶上的「回到项目」卡片（host.ui.ProjectBackCard）要用。
 * 旧面板没有那个组件，用之前判断
 */
let host: WebHost | undefined // 模块状态：activate 时记一次
export const setUiDesignHost = (h: WebHost) => {
  host = h
}
export const uiDesignHost = () => host
