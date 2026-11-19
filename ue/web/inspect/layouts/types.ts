import type { ComponentType } from 'react'
import type { OpenHow } from '../../details/RefChip.tsx'

/**
 * 资源查看布局的约定（设计稿「资源查看页-按UE编辑器布局」第 2 节）：每种资源类型一套布局，一个文件夹，
 * 登记进 registry.ts。AssetView 只按类名、类链在注册表里挑第一个匹配的布局，自己不写类型分支。
 * 这个文件只放类型和纯数据（布局的元信息在各文件夹的 def.ts），单测能直接 import，不带 React 组件。
 */

/** 挑布局时知道的资源信息：类名和类链读回来之前按路径猜（guessInfo） */
export interface LayoutInfo {
  /** 资源的类（WidgetBlueprint、DataTable…）；还没读回来时是猜的 */
  cls?: string
  /** 父类链（asset.describe 的 classChain，近的在前），旧桥接没有 */
  classChain?: string[]
  /** 对象路径 /Game/A/B.B（组件模板这类子对象带冒号） */
  path: string
}

/** 布局里的一块区域：左 / 右是宽度，底和左下是高度；尺寸按「布局 id + 区域 id」记在本机 */
export interface RegionDef {
  id: string
  /** 设置页里显示的名字（函数：界面语言在激活后才定，单测不调它） */
  label: () => string
  /** 默认尺寸：像素（'280px'）或百分比（'22%'） */
  size: string
  min: number
  /** 放在哪：左栏、左栏下半、右栏、中间下面；左下和底部是高度，其余是宽度 */
  place: 'left' | 'leftBottom' | 'right' | 'bottom'
  /** 用户能在设置里关掉的区域（例如不要动画栏） */
  optional?: boolean
}

/** 布局的元信息（纯数据）：设置页列表、挑布局、单测都只用它 */
export interface LayoutDef {
  id: string
  /** 设置页、示例里的名字 */
  label: () => string
  /** 设置页「匹配哪些类」一栏（只给人看，匹配以 match 为准；兜底布局写「其他所有类型」） */
  classes: () => string[]
  /** 越大越先比（从具体到一般）；通用布局是 0，兜底 */
  priority: number
  match: (info: LayoutInfo) => boolean
  regions: RegionDef[]
  /** 资源还没生成（AssetForge 按配置预览）时也能画：不问 UE，只用配置 */
  offline?: boolean
}

/** AssetForge 的配置原文（AssetForge 页「资源」页签传进来；资源页自己按资产问 forge.describe） */
export interface AssetConfig {
  text?: string
  truncated?: boolean
  loading?: boolean
  error?: string
}

/** 每个布局组件拿到的参数：AssetView 的参数原样转过来，加上挑中的布局和资源信息 */
export interface LayoutProps {
  path: string
  comp: string
  onComp: (comp: string) => void
  onOpen: (path: string, via?: string, how?: OpenHow) => void
  onChanged?: () => void
  hint?: string
  marks?: Map<string, unknown>
  config?: AssetConfig
  /** 资源还没生成：只按配置画（layout.offline 的布局才会收到 true） */
  offline?: boolean
  info: LayoutInfo
  layout: LayoutDef
}

export interface Layout extends LayoutDef {
  Component: ComponentType<LayoutProps>
}
