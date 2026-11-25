/**
 * 「同一次提交里一起改的资源」的分组、摘要（版本差异页上方那一条）。纯逻辑：网页和单测共用，不碰界面。
 * 一次 P4 merge / copy 能带进几百上千个资源（用户 2026-11-25 截图 491 个平铺成标签墙），
 * 所以界面只画摘要一行，展开后按文件夹或类型分组、虚拟滚动；这里负责算组和类型分布
 */

/** 一个资源：包路径 + 类（认不出是空串） */
export interface ChangeAsset {
  pkg: string
  cls: string
}

export interface ChangeGroup {
  /** 分组键：文件夹路径，或类名（认不出的是空串） */
  key: string
  items: ChangeAsset[]
}

/** 资源所在的文件夹（/Game/A/B → /Game/A） */
export function folderOf(pkg: string): string {
  const i = pkg.lastIndexOf('/')
  return i > 0 ? pkg.slice(0, i) : '/'
}

export const nameOf = (pkg: string) => pkg.slice(pkg.lastIndexOf('/') + 1)

/**
 * 按文件夹或按类分组：组按个数从多到少（同样多按键排），组里按名字排。
 * keyOf 给类分组时传「类 → 显示分组」的映射（动画序列和蒙太奇算一类时由调用方决定）
 */
export function groupAssets(
  items: ChangeAsset[],
  by: 'folder' | 'type',
  keyOf: (a: ChangeAsset) => string = (a) => a.cls,
): ChangeGroup[] {
  const m = new Map<string, ChangeAsset[]>()
  for (const a of items) {
    const k = by === 'folder' ? folderOf(a.pkg) : keyOf(a)
    const list = m.get(k)
    if (list) list.push(a)
    else m.set(k, [a])
  }
  const groups = [...m].map(([key, list]) => ({
    key,
    items: list.sort((x, y) => nameOf(x.pkg).localeCompare(nameOf(y.pkg))),
  }))
  // 按文件夹时按路径排，读起来和目录一样；按类型时多的在前，一眼看出这次提交主要是什么
  return by === 'folder'
    ? groups.sort((x, y) => x.key.localeCompare(y.key))
    : groups.sort((x, y) => y.items.length - x.items.length || x.key.localeCompare(y.key))
}

/** 摘要里的类型分布：取前 top 种，剩下的并成 rest（个数） */
export function typeSpread(
  items: ChangeAsset[],
  keyOf: (a: ChangeAsset) => string,
  top = 3,
): { parts: { key: string; n: number }[]; rest: number } {
  const groups = groupAssets(items, 'type', keyOf)
  const parts = groups.slice(0, top).map((g) => ({ key: g.key, n: g.items.length }))
  const rest = groups.slice(top).reduce((s, g) => s + g.items.length, 0)
  return { parts, rest }
}

/** 超过这么多个就默认收起（设置里选了默认展开也一样）：几十个以内摊开看还行，再多就把差异挤没了 */
export const OPEN_MAX = 12

/**
 * 整批搬运的提交（P4 integrate / copy / merge、git merge）：一起进来的资源多半只是跟着分支过来，
 * 不一定和正在看的资源的改动有关，界面上提示一句。按提交说明里的常见写法认，认不出就当普通提交
 */
export function bulkKind(message: string): 'merge' | 'copy' | undefined {
  const m = message.slice(0, 200)
  if (/\bcopy(ing)?\b.*\/\/|^\s*copy\b|\[[^\]]*copy[^\]]*\]|拷贝|复制分支/i.test(m)) return 'copy'
  if (/\bmerg(e|ing)\b|\bintegrat(e|ing|ion)\b|\[[^\]]*merge[^\]]*\]|合并|合入/i.test(m)) return 'merge'
  return undefined
}
