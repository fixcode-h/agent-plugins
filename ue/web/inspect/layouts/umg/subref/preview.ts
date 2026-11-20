import { t } from '../../../../host.ts'
import type { Rect } from '../approx.ts'
import type { WNode } from '../model.ts'

/**
 * 设计器里和子界面、WidgetSwitcher 有关的小规则（纯函数，单测在 subref.test.ts）。
 */

const under = (key: string, sel: string) => sel === key || sel.startsWith(`${key}/`)

/**
 * WidgetSwitcher 只画当前页（ActiveWidgetIndex，没写是 0）；在控件树里选中某一页（或页里的控件）时，
 * 设计器切到那一页显示——UE 控件蓝图设计器就是这样，只是预览，不改 ActiveWidgetIndex 本身。
 * 选中路径上每个 Switcher 的 active 换成路径经过的那一页；没有要换的原样返回同一个对象（调用方据此判断「在看别的页」）。
 */
export function previewPages(root: WNode, selected?: string): WNode {
  if (!selected) return root
  const visit = (n: WNode): WNode => {
    const i = n.children.findIndex((c) => under(c.key, selected))
    if (i < 0) return n
    const kid = visit(n.children[i])
    const flip = n.cls === 'WidgetSwitcher' && (n.active ?? num(n.props?.ActiveWidgetIndex)) !== i
    if (!flip && kid === n.children[i]) return n
    const children = kid === n.children[i] ? n.children : n.children.map((c, j) => (j === i ? kid : c))
    return { ...n, children, ...(flip ? { active: i } : {}) }
  }
  return visit(root)
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * 选中框画在哪：控件自己的矩形；没有（UE 渲染图只给父 WBP 自己 WidgetTree 里的控件矩形，子界面内部的不在里面）
 * 就往上找最近的有矩形的祖先，至少框住它所在的子界面
 */
export function rectOrAncestor(key: string | undefined, rects: Map<string, Rect>, parent: Map<string, WNode>) {
  let k = key
  while (k) {
    const r = rects.get(k)
    if (r) return r
    k = parent.get(k)?.key
  }
  return undefined
}

/**
 * 有 UE 的控件树时核对配置里的子界面：配置写了 ref、UE 那边对应位置却没有子界面实例，
 * 多半是子 WBP 还没生成、或父 WBP 还没按新配置重新导入——UE 渲染图里那块自然是空的，在画布上写明原因
 */
export function liveRefIssues(cfg: WNode | undefined, live: WNode | undefined): string[] {
  if (!cfg || !live) return []
  const byKey = new Map<string, WNode>()
  const walk = (n: WNode) => {
    byKey.set(n.key, n)
    n.children.forEach(walk)
  }
  walk(live)
  const out: string[] = []
  const check = (n: WNode) => {
    if (n.src) return
    if (n.ref) {
      const l = byKey.get(n.key)
      if (!l) out.push(t('{n} 在 UE 的控件树里没有：父 WBP 还没按这份配置重新导入', { n: n.name }))
      else if (!l.user)
        out.push(
          t('{n} 在 UE 里不是子界面（是 {c}）：子 WBP 可能还没生成，先导入 {r}', { n: n.name, c: l.cls, r: n.ref }),
        )
    }
    n.children.forEach(check)
  }
  check(cfg)
  return out
}
