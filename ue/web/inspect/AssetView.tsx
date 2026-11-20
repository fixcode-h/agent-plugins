import { useMemo } from 'react'
import { op, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import type { OpenHow } from '../details/RefChip.tsx'
import { classOfKind, guessClass } from './layouts/pick.ts'
import { layoutFor } from './layouts/registry.ts'
import type { AssetConfig, LayoutInfo } from './layouts/types.ts'
import { configKind } from './layouts/umg/config.ts'

export interface AssetViewProps {
  /** 资源的对象路径 /Game/A/B.B */
  path: string
  /** Actor 蓝图选中的组件模板（地址里 `资源|组件`）；空的是资源本身 */
  comp?: string
  onComp: (comp: string) => void
  /** 点了属性、蓝图、摘要里的引用：via 是从哪来的（属性名、「蓝图」「引用」），how.ctrl 是 Ctrl+点 */
  onOpen: (path: string, via?: string, how?: OpenHow) => void
  /** 改了资源（表格单元格、蓝图编译）：资源页刷新「未保存」列表 */
  onChanged?: () => void
  /** 属性上面的说明（不放在检视区里时用，例如「改动点保存才写回」）；检视区有资源提示条，不给 */
  hint?: string
  /** 属性标注（AssetForge：导入会改的顶层属性 → 导入后的值）；只在看资源本身时标，看组件模板时不标 */
  marks?: Map<string, unknown>
  /** AssetForge 的配置原文（AssetForge 页传进来）：UMG 布局的「配置原文」、近似预览和动画从它读 */
  config?: AssetConfig
  /** 资源还没生成：不问 UE，只按配置挑布局、画（canOffline 为真的配置才这样用） */
  offline?: boolean
}

/** 资源还没生成时，这份配置有没有能按配置画的布局（AssetForge「资源」页签用它决定用布局还是旧的按配置预览） */
export function canOffline(configText?: string, kind?: string) {
  // 原文还没读到时用列表里的 kind（AssetForge 左栏有），布局框架先摆出来
  const cls = classOfKind(configKind(configText) ?? kind)
  return !!cls && layoutFor({ cls, path: '' }).offline === true
}

/**
 * 资源的检视（对象页、资源页、AssetForge 页共用；设计稿「资源查看页-按UE编辑器布局」第 2 节）：
 * 读出资源的类和类链，在布局注册表（layouts/registry.ts）里挑布局交给它画；类型读回来之前按路径猜。
 * 这里不按类型写分支：DataTable、蓝图、控件蓝图、其他资源各是 layouts/ 下的一个文件夹。
 * 只管看和改，不管保存（保存在资源页左栏「当前修改」和「改动」页，asset-dirty/），也不管导航历史（onOpen 交给外面）
 */
export function AssetView(props: AssetViewProps) {
  const { path, comp = '', offline, config } = props
  const { project } = useUe()
  const desc = useLoad(
    () =>
      offline
        ? Promise.resolve(undefined)
        : op<{ class: string; classChain?: string[] }>(project.id, 'asset.describe', { path }, undefined, 120000).then(
            (r) => ({ path, cls: r.class, chain: r.classChain }),
          ),
    [project.id, path, offline],
    0,
    `${project.id}/assetview/cls/${path}`,
  )
  const got = desc.data?.path === path ? desc.data : undefined
  const kindCls = offline ? classOfKind(configKind(config?.text) ?? config?.kind) : undefined
  const info: LayoutInfo = useMemo(
    () => ({ path, cls: got?.cls ?? kindCls ?? guessClass(path), classChain: got?.chain }),
    [path, got, kindCls],
  )
  const layout = layoutFor(info)
  const Layout = layout.Component
  return (
    <Layout key={layout.id} {...props} comp={comp} offline={offline && layout.offline} info={info} layout={layout} />
  )
}
