import type * as ReactNS from 'react'
import type { ComponentType, ReactNode } from 'react'
import type { PluginConfig } from './server.ts'

/**
 * 插件网页 SDK：插件包里 web 入口的约定。这是 agent-panel 的 web/src/plugins/sdk.ts 的副本（面板 ADR 0059）。
 * 面板里的 WebHost 是 web/src/plugins/host.ts 的返回类型，这里按它手写了插件用得到的形状；面板改了要同步过来。
 *
 * 入口是一个 ESM 文件，默认导出 activate(host)，返回 WebPlugin。React 用面板的那一份：构建时把 react、
 * react/jsx-runtime、react-dom 换成 globalThis.__agentPanel 上的（scripts/build.mjs），自己的其他依赖打包进去。
 * Tailwind 类名用面板的主题变量（bg-panel、text-muted…，见 sdk/theme.css），样式表由插件自己构建、放在包里。
 */

/** 面板的对话（只列插件用到的字段，其余字段照样在） */
export interface Task {
  id: string
  projectId: string
  title?: string
  status: string
  plugin?: string
  /** 老版本面板的模型设计标记，面板读成 plugin = 'blender.model' */
  modelDesign?: boolean
  [k: string]: unknown
}

export interface Project {
  id: string
  name: string
  path: string
  [k: string]: unknown
}

export interface TaskInput {
  projectId: string
  mode: 'chat' | 'workflow' | 'agent'
  workflowId: string
  agentId: string
  cli: string
  model: string
  effort: string
  params: Record<string, unknown>
  prompt: string
  attachments: unknown[]
  askUser?: boolean
  /** 归哪个插件的设计模式（DesignMode.id） */
  plugin?: string
}

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>
// 面板组件的属性很多，这里不逐个抄：按面板里的用法传
// oxlint-disable-next-line typescript/no-explicit-any
type Loose = ComponentType<any>

export interface WebHost {
  pluginId: string
  React: typeof ReactNS
  t: (zh: string, vars?: Record<string, string | number>) => string
  lang: () => string
  /** 当前参数（按清单声明补齐默认值） */
  config: () => PluginConfig
  /** 插件自己的接口（服务端 ServerPlugin.fetch），路径写插件里的，例如 '/models/x' */
  api: {
    url: (path: string) => string
    get: <T>(path: string) => Promise<T>
    post: <T>(path: string, body?: unknown) => Promise<T>
  }
  /** 插件包里的文件地址 */
  fileUrl: (rel: string) => string
  panel: {
    createTask: (input: TaskInput) => Promise<Task>
    createProject: (input: { name: string; path: string }) => Promise<Project>
    makeDir: (parent: string, name: string) => Promise<{ path: string }>
  }
  hooks: {
    useData: () => {
      projects: Project[]
      setProjects: (f: (ps: Project[]) => Project[]) => void
      upsertTask: (t: unknown) => void
    }
    useTasks: () => unknown
    useNav: () => { go: (r: Record<string, unknown>) => void; openSettings: (section?: string) => void }
    useDirInfo: (dir: string) => { exists: boolean; isDir: boolean; path: string } | null | undefined
    useNewAskUser: () => [boolean, (v: boolean) => void]
    /** 插件整页的子位置（插件接口 2）：#/plugin/<插件>/<页面>/<path> */
    usePluginRoute: () => { page: string; path: string; go: (page: string, path?: string) => void }
    /**
     * 把一段文字接进对话的输入框草稿再打开那个对话（不直接发送）；没给 taskId 时放进项目新建对话的输入框。
     * 2026-11-10 加的，旧面板没有：用之前先判断有没有
     */
    useToChat?: () => (o: { projectId: string; taskId?: string; text: string }) => void
  }
  ui: {
    Button: Loose
    IconButton: Loose
    EmptyPanel: Loose
    Field: Loose
    Input: Loose
    Select: Loose
    Textarea: Loose
    Modal: Loose
    Segmented: Loose
    DirPicker: Loose
    TaskView: Loose
  }
  toast: { error: (m: string) => void; success: (m: string) => void }
  cn: (...c: unknown[]) => string
  taskSummary: (t: Task) => unknown
}

/** 设计模式下多出来的一类设计（侧栏顶上的下拉里一项）：对话按 task.plugin = id 归它，打开时进 #/pdesign/<id>/<对话> */
export interface DesignMode {
  id: string
  name: string
  desc: string
  icon: Icon
  /** 图标底色（主题里的状态色类名，例如 bg-peer） */
  tone?: string
  /** 侧栏空列表的说明和新建按钮的文字 */
  empty: string
  newLabel: string
  /** 新建这类设计的弹窗：建好后调 onCreated(对话) 打开它 */
  NewDialog: ComponentType<{ open: boolean; onOpenChange: (o: boolean) => void; onCreated: (task: Task) => void }>
}

/** 对话右栏多一个页签 */
export interface TaskTab {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** 哪些对话有这个页签 */
  when: (task: Task) => boolean
  /** 有这个页签的对话右栏默认停在它上面、默认展开右栏 */
  home?: boolean
  Panel: ComponentType<{ task: Task }>
}

/**
 * 插件自己的整页（插件接口 2）：宽屏在图标栏通用功能下面另起一组，手机在抽屉菜单里；地址 #/plugin/<插件>/<页面>/<path>。
 * path 是插件自己的子位置（一段字符串，插件自己编码），用 host.hooks.usePluginRoute 读写
 */
export interface PluginPage {
  id: string
  label: string
  /** 函数组件（lucide 图标或自己画的 svg）：图标栏按 24px、线宽 1.75 画 */
  icon: (p: { className?: string; strokeWidth?: number }) => ReactNode
  /** 图标右上角的小点（有新内容、出错），给文字时也写进悬停提示 */
  useDot?: () => string | boolean | undefined
  Page: ComponentType<{ path: string }>
}

export interface WebPlugin {
  designModes?: DesignMode[]
  pages?: PluginPage[]
  taskTabs?: TaskTab[]
  /** 插件页上参数表单下面的运行状态面板：status 是服务端 ServerPlugin.status 的结果 */
  Status?: ComponentType<{ status: Record<string, unknown> | undefined; config: PluginConfig; reload: () => void }>
}

export type ActivateWeb = (host: WebHost) => WebPlugin | Promise<WebPlugin>
