/**
 * 「此刻实例」栏按所属成树（用户 2026-11-21）：候选的对象路径（GameTest 2.1.3 起 gt.resolve 给 path）本身就是所属链，
 * `/Game/Maps/Main.Main:PersistentLevel.BP_Door_C_1` → Main › PersistentLevel › BP_Door_C_1；界面挂在 WidgetTree 下也一样。
 * 所有实例共有的开头几层合成一行，免得每个都多套几层；没有 path 的（旧版 GameTest）平铺在最上面
 */
export interface OwnerRow<T> {
  key: string
  depth: number
  /** 分组行（所属对象）：label；实例行：item */
  label?: string
  item?: T
  count?: number
}

interface Node<T> {
  label: string
  kids: Map<string, Node<T>>
  items: T[]
}

/** 对象路径 → 所属链（去掉包路径的目录部分和自己） */
export function ownerChain(path: string): string[] {
  const body = path.replace(/^.*\//, '')
  // 包名和里面的主对象同名（Main.Main）只留一个
  return body
    .split(/[.:]/)
    .filter(Boolean)
    .slice(0, -1)
    .filter((x, i, a) => x !== a[i - 1])
}

export function ownerRows<T>(items: T[], pathOf: (x: T) => string | undefined, open: (key: string) => boolean) {
  const root: Node<T> = { label: '', kids: new Map(), items: [] }
  for (const it of items) {
    const p = pathOf(it)
    let n = root
    for (const seg of p ? ownerChain(p) : []) {
      if (!n.kids.has(seg)) n.kids.set(seg, { label: seg, kids: new Map(), items: [] })
      n = n.kids.get(seg)!
    }
    n.items.push(it)
  }
  const count = (n: Node<T>): number => n.items.length + [...n.kids.values()].reduce((s, k) => s + count(k), 0)
  // 只有一条路往下、自己没有实例的层合成一行
  const squash = (n: Node<T>): Node<T> => {
    let cur = n
    const parts = [n.label]
    while (!cur.items.length && cur.kids.size === 1) {
      cur = [...cur.kids.values()][0]
      parts.push(cur.label)
    }
    return { ...cur, label: parts.filter(Boolean).join(' › ') }
  }
  const out: OwnerRow<T>[] = []
  const walk = (n: Node<T>, depth: number, key: string) => {
    for (const it of n.items) out.push({ key: `${key}#${out.length}`, depth, item: it })
    for (const raw of n.kids.values()) {
      const k = squash(raw)
      const id = `${key}/${k.label}`
      out.push({ key: id, depth, label: k.label, count: count(k) })
      if (open(id)) walk(k, depth + 1, id)
    }
  }
  // 最外层也合并：大家都在同一个关卡 / 同一个父界面下时不必多点一层
  const top = root.items.length ? root : squash(root)
  if (top !== root && top.label) {
    out.push({ key: `/${top.label}`, depth: 0, label: top.label, count: count(top) })
    if (open(`/${top.label}`)) walk(top, 1, `/${top.label}`)
  } else walk(root, 0, '')
  return out
}
