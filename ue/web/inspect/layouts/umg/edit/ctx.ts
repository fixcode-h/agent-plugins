import { createContext, useContext } from 'react'
import type { Expanded } from '../../../../../shared/forge-doc/include.ts'

/**
 * 「能直接改配置文件」的上下文：AssetForge 页的「资源」页签给（它知道配置根、配置路径和展开 include 后的配置），
 * UMG 布局深处的细节面板从这里取，不一层层传。没有这个上下文（资源页）时细节面板照旧只读。
 * 写回走 AssetForge 页「配置原文」保存用的同一条接口 ext/forge/read + ext/forge/save（带修改时间，防覆盖别人刚存的）。
 */
export interface ConfigEdit {
  project: string
  configRoot: string
  /** 主配置（相对配置根） */
  main: string
  /** 展开 include 之后的配置：节点在哪份文件靠它的 sources 查 */
  expanded: Pick<Expanded, 'doc' | 'sources'>
  /** 写完了：让页面重读配置（预览、控件树、其它页签跟着刷新） */
  onSaved: () => void
  /** 写不了时跳到「配置原文」 */
  openConfig?: () => void
}

export const ConfigEditCtx = createContext<ConfigEdit | null>(null)
export const useConfigEdit = () => useContext(ConfigEditCtx)
