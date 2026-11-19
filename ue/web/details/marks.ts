import { createContext, useContext } from 'react'

/**
 * 属性标注：外面告诉属性面板「这几个属性会变成什么」（AssetForge 选中配置时标出导入会改的属性，设计稿 §2.2）。
 * 键是顶层属性名（和 forge.diff 的 property 一致），值是导入后的值；只标顶层行，展开的子行不标。
 * 用 context 而不是一路传参：Props → Details → Rows → Row 隔了好几层，别的地方用不到这个参数
 */
export const PropMarksCtx = createContext<Map<string, unknown> | null>(null)
export const usePropMark = (path: string, depth: number) => {
  const marks = useContext(PropMarksCtx)
  return depth === 0 && marks?.has(path) ? { after: marks.get(path) } : undefined
}

/**
 * 被动画驱动的属性（UMG 布局：选中的控件在当前动画里有轨道的属性，设计稿第 2 节「被动画驱动的属性加菱形标记」）：
 * 键是顶层属性名（RenderOpacity、RenderTransform、Slot.Padding），值是悬停提示（哪段动画、哪些通道）
 */
export const PropAnimCtx = createContext<Map<string, string> | null>(null)
export const usePropAnim = (path: string, depth: number) => {
  const m = useContext(PropAnimCtx)
  return depth === 0 ? m?.get(path) : undefined
}
