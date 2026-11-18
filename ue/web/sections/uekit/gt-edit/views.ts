import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { EditResult, GtPath, GtScript } from '../../../../shared/gt-script/index.ts'

/**
 * 编辑页的视图（定稿 9.1「一份数据，三种看法」，协议第 14 节的视图注册表）：列表、流程图、JSON 都是同一份数据的看法。
 * 视图只拿数据、选中和改的入口，不自己读写文件；加一种视图：写一个组件、registerView 一次（流程图在 gt-flow 里注册自己）
 */
export interface ViewProps {
  doc: GtScript
  /** 应用一次改动；做不了的（返回 undefined）带一句 what 提示 */
  onChange: (r: EditResult | GtScript | undefined, what?: string) => boolean
  selected: GtPath[]
  onSelect: (paths: GtPath[]) => void
  /** 试一下这一步（连着编辑器时才有） */
  onTry?: (path: GtPath) => void
  /** 运行中的进度：按步骤 id 标状态，视图自己决定怎么画 */
  run?: { at?: string; status?: Record<string, 'ok' | 'fail' | 'run' | 'skip'> }
}

export interface ViewDef {
  id: string
  label: () => string
  icon: LucideIcon
  /** 小的在前 */
  order: number
  Component: ComponentType<ViewProps>
}

const views: ViewDef[] = []

export function registerView(v: ViewDef) {
  const i = views.findIndex((x) => x.id === v.id)
  if (i >= 0) views[i] = v
  else views.push(v)
  views.sort((a, b) => a.order - b.order)
}

export const allViews = () => views
