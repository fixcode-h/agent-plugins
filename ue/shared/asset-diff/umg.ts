import type { AnimDiff, ChannelDiff, ObjDiff, SnapAnim, SnapProp, SnapWidget } from './types.ts'

/**
 * 控件蓝图的控件树、动画差异（设计稿「UE资源版本差异-修复与强化」3.7，快照字段 UELink 2.21）：
 * 控件按名字配对（UE 保证一个控件树里控件名不重），插槽属性并进同一张表、分类写成「插槽（类）」，
 * 挪了父控件算改了一项「父控件」。动画按名字配对，通道按「控件路径 · 通道」配对，关键帧串起来比
 */
type ObjDiffFn = (key: string, a: SnapWidget | undefined, b: SnapWidget | undefined) => ObjDiff

const lastSeg = (p: string) => p.split('/').pop() ?? p

/** 控件自己的属性 + 插槽属性（名字带 Slot. 前缀，不和控件属性撞名） */
export function flatten(w: SnapWidget | undefined): SnapWidget | undefined {
  if (!w) return undefined
  const slot: SnapProp[] = (w.slot ?? []).map((p) => ({
    ...p,
    name: `Slot.${p.name}`,
    category: `插槽（${w.slotClass ?? 'Slot'}）`,
  }))
  const parent: SnapProp = { name: 'ParentWidget', displayName: '父控件', category: '层级', value: lastSeg(w.parent) }
  return { ...w, props: [parent, ...slot, ...w.props] }
}

export function widgetDiffs(
  a: SnapWidget[] | undefined,
  b: SnapWidget[] | undefined,
  objDiff: ObjDiffFn,
): ObjDiff[] {
  if (!a?.length && !b?.length) return []
  const ma = new Map((a ?? []).map((w) => [w.name, w]))
  const mb = new Map((b ?? []).map((w) => [w.name, w]))
  // 新版的顺序（按路径排好的，父在子前）在前，再补只在旧版里的
  const names = [...new Set([...mb.keys(), ...ma.keys()])]
  return names.map((n) => {
    const wa = ma.get(n)
    const wb = mb.get(n)
    const d = objDiff(n, flatten(wa), flatten(wb))
    d.parent = lastSeg((wb ?? wa)!.parent)
    return d
  })
}

const keysText = (keys: [number, number][]) =>
  keys.map(([t, v]) => `${+t.toFixed(3)}s→${+v.toFixed(4)}`).join('  ')

export function animDiffs(a: SnapAnim[] | undefined, b: SnapAnim[] | undefined): AnimDiff[] {
  if (!a?.length && !b?.length) return []
  const ma = new Map((a ?? []).map((x) => [x.name, x]))
  const mb = new Map((b ?? []).map((x) => [x.name, x]))
  return [...new Set([...mb.keys(), ...ma.keys()])].map((name) => {
    const xa = ma.get(name)
    const xb = mb.get(name)
    const ca = new Map((xa?.channels ?? []).map((c) => [`${c.target} · ${c.channel}`, keysText(c.keys)]))
    const cb = new Map((xb?.channels ?? []).map((c) => [`${c.target} · ${c.channel}`, keysText(c.keys)]))
    const channels: ChannelDiff[] = [...new Set([...cb.keys(), ...ca.keys()])].map((key) => {
      const va = ca.get(key)
      const vb = cb.get(key)
      const change = va === undefined ? 'add' : vb === undefined ? 'del' : va === vb ? 'same' : 'mod'
      return { key, change, ...(va !== undefined && { a: va }), ...(vb !== undefined && { b: vb }) }
    })
    const change =
      !xa ? 'add' : !xb ? 'del' : xa.length !== xb.length || channels.some((c) => c.change !== 'same') ? 'mod' : 'same'
    return { name, change, lengthA: xa?.length, lengthB: xb?.length, channels }
  })
}
