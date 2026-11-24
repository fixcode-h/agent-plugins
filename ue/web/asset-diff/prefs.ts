import * as vd from '@panel/web/src/components/ui/version-diff'

/**
 * 设置 → 组件「版本差异」里的几项（设计稿「UE资源版本差异-修复与强化」3.8）：读取超过几秒提示 UE 在忙、属性来历一次往回几版、
 * 同一提交的资源条默认展开还是收起。旧面板没有 useVersionDiffPrefs 时用默认值
 */
const DEF = { busySec: 60, historyMax: 20, sameCommitOpen: true }
const fromPanel = (vd as Record<string, unknown>).useVersionDiffPrefs as (() => typeof DEF) | undefined
export const useDiffPrefs: () => typeof DEF = fromPanel ?? (() => DEF)
