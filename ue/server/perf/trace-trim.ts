/** 调用树的节点（和桥接 trace.query 的 butterfly / tree 一样） */
export interface TreeNode {
  id: number
  name: string
  count: number
  incl: number
  excl?: number
  children?: TreeNode[]
  more?: number
}

/**
 * 自上而下调用树（what=tree，火焰图同一份数据）裁给 Agent：每层按包含时间从热到冷，只留最热的几支，
 * 从宽到窄试几档，直到整棵树的 JSON 不超过 budget 字（默认 4000，ADR 0067）；被裁掉的子节点个数记在 more
 */
export function trimTree(root: TreeNode, budget = 4000): TreeNode {
  const cut = (n: TreeNode, kids: number, depth: number, d = 0): TreeNode => {
    const all = [...(n.children ?? [])].sort((a, b) => b.incl - a.incl)
    // 太冷的分支（不到父节点 2%）不展开，留给 more
    const hot = all.filter((k) => k.incl >= n.incl * 0.02).slice(0, kids)
    const kept = d < depth ? hot : []
    const more = all.length - kept.length + (n.more ?? 0)
    return {
      id: n.id,
      name: n.name,
      count: n.count,
      incl: n.incl,
      ...(n.excl !== undefined ? { excl: n.excl } : {}),
      ...(kept.length ? { children: kept.map((k) => cut(k, kids, depth, d + 1)) } : {}),
      ...(more ? { more } : {}),
    }
  }
  const steps: [number, number][] = [
    [8, 8],
    [6, 7],
    [5, 6],
    [4, 6],
    [3, 5],
    [3, 4],
    [2, 4],
    [2, 3],
    [1, 3],
  ]
  let out = cut(root, 1, 1)
  for (const [kids, depth] of steps) {
    out = cut(root, kids, depth)
    if (JSON.stringify(out).length <= budget) return out
  }
  return out
}
