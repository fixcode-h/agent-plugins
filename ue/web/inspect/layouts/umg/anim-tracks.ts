import { toDisplay } from '../../../details/model.ts'
import { channelProps, type Anim } from '../../../timeline/keys.ts'
import type { TlGroup } from '../../../timeline/Timeline.tsx'
import { resolveTarget, type indexTree } from './model.ts'

/** 通道名写成细节面板的样子：RenderTransform.Translation.X → Render Transform · Translation.X */
export function channelLabel(ch: string) {
  const [head, ...rest] = ch.split('.')
  const top = head.toLowerCase() === 'slot' ? 'Slot' : toDisplay(head)
  return rest.length ? `${top} · ${rest.join('.')}` : top
}

/** 一段动画按控件分组成时间轴的轨道：组 id 是控件 key（找不到控件时用 target 原文），通道 id 是轨道下标 */
export function animGroups(anim: Anim | undefined, idx: ReturnType<typeof indexTree>): TlGroup[] {
  const groups = new Map<string, TlGroup>()
  anim?.tracks.forEach((tr, i) => {
    const n = resolveTarget(idx, tr.target)
    const id = n?.key ?? tr.target
    const g = groups.get(id) ?? { id, label: n?.name ?? tr.target.split('/').pop() ?? tr.target, channels: [] }
    g.channels.push({ id: String(i), label: channelLabel(tr.channel), keys: tr.keys })
    groups.set(id, g)
  })
  return [...groups.values()]
}

/** 选中控件在这段动画里被驱动的属性（细节面板打菱形）：顶层属性名 → 通道列表 */
export function animatedProps(anim: Anim | undefined, idx: ReturnType<typeof indexTree>, key?: string) {
  const out = new Map<string, string[]>()
  if (!key) return out
  for (const tr of anim?.tracks ?? []) {
    if (resolveTarget(idx, tr.target)?.key !== key) continue
    for (const p of channelProps(tr.channel)) out.set(p, [...(out.get(p) ?? []), tr.channel])
  }
  return out
}
