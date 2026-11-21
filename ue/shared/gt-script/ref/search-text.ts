/**
 * 搜索比对的那一段（小写）：Lua 模块名带目录（a.b.c），只比最后一段，不然搜一个目录名会把目录下全部模块都当命中
 * （用户 2026-11-21）；q 里带 . 或 / 时按整条路径比。和 UE 侧 gt.classes 的 SearchText 一致
 */
export function searchText(name: string, q: string): string {
  const low = name.toLowerCase()
  if (/[./]/.test(q)) return low
  return low.slice(Math.max(low.lastIndexOf('.'), low.lastIndexOf('/')) + 1)
}
