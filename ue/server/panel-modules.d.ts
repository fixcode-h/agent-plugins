// 面板开放给插件的模块（sdk/host-modules.json），构建时由 scripts/build.mjs 接到面板那一份。
// ue 插件不照面板源码布局放文件、不从 .panel 取类型，这里只声明用到的那几个函数
declare module '@panel/server/download' {
  export function downloadFile(
    url: string,
    to: string,
    o?: { signal?: AbortSignal; headers?: Record<string, string>; connections?: number; idleMs?: number },
  ): Promise<void>
}

// 网页：面板的接口请求（带访问令牌、出错抛出接口给的原因）。GM 参数下拉经面板动作入口 /actions/table.* 读表格插件的数据
declare module '@panel/web/src/lib/api' {
  export function request<T>(url: string, init?: RequestInit): Promise<T>
}

/** 面板的拼音首字母（GM 页左栏分组按 jszl 这类首字母搜） */
declare module '@panel/shared/pinyin' {
  export function pinyinInitials(s: string): string
}

/**
 * 网页：在项目里开一个 AI 分析对话跑一段提示词（插件接口 6 开放）。GameTest「AI 整理」用：
 * 每一轮说完把最后一条回复交给 resolve，返回 error 时让对话自己修正一次
 */
declare module '@panel/web/src/lib/assist-conv' {
  export function runPromptInProject(opts: {
    projectId: string
    title: string
    prompt: () => Promise<string>
    analysis?: 'init' | 'run' | string
    resolve: (reply: string) => Promise<{ error?: string }>
  }): void
}

/**
 * 网页：面板的通用流程图画布（点状底、缩放、右下小地图、底部工具条，面板 web/src/components/flow/GraphCanvas.tsx）。
 * GameTest 流程图用它，外观和工作流编辑器一致；节点用同样开放的 @xyflow/react 写（和面板共用一份实例）
 */
declare module '@panel/web/src/components/flow/GraphCanvas' {
  import type { ComponentType, HTMLAttributes, ReactElement, ReactNode } from 'react'
  import type { Edge, Node, ReactFlowProps } from '@xyflow/react'
  export type GraphCanvasProps<N extends Node = Node, E extends Edge = Edge> = ReactFlowProps<N, E> & {
    editable?: boolean
    panMode?: boolean
    minimap?: number | false
    miniColor?: (n: N) => string
    autoFit?: boolean
    frameClassName?: string
    children?: ReactNode
  }
  export function GraphCanvas<N extends Node = Node, E extends Edge = Edge>(p: GraphCanvasProps<N, E>): ReactElement
  export function CanvasToolbar(p: HTMLAttributes<HTMLDivElement>): ReactElement
  export const CanvasToolbarSep: ComponentType
}

/** 网页：圆底数字角标（没发生不画，超过 999 写「999+」，面板 web/src/components/ui/count-badge.tsx） */
declare module '@panel/web/src/components/ui/count-badge' {
  import type { HTMLAttributes, ReactElement } from 'react'
  export const COUNT_BADGE_MAX: number
  export function countBadgeText(n: number, max?: number): string
  export function CountBadge(
    p: Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & { count: number; max?: number; corner?: boolean },
  ): ReactElement | null
}
