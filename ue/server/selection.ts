import { info, liveCards } from './instances.ts'
import { runOp, type OpCtx } from './ops.ts'

/**
 * 编辑器里现在选中了什么（UELink 2.4 的 editor.selection，设计稿「UE 插件优化与扩展」二 P0）：ue_status 带上它，
 * Agent 听到「看看我选中的这个」时不用让用户复制路径。只取前几个，三行以内；桥接旧、编辑器没开时不给（不报错）
 */
interface Sel {
  actors?: { path: string; label?: string; name: string }[]
  actorCount?: number
  assets?: { path: string }[]
  folders?: string[]
  blueprint?: { path: string; graph?: string; nodes?: { id: string; title: string }[] }
}

export async function selectionBrief(ctx: OpCtx) {
  const card = (await liveCards(ctx.project.root)).find((c) => c.kind === 'editor')
  if (!card) return undefined
  const inst = await info(card)
  if (!inst.ops?.includes('editor.selection')) return undefined
  try {
    const s = (await runOp({ ...ctx, target: { instance: card.pid } }, 'editor.selection', {}, 5000)) as Sel
    const out: Record<string, unknown> = {}
    if (s.actors?.length)
      out.actors = {
        count: s.actorCount ?? s.actors.length,
        first: s.actors.slice(0, 3).map((a) => (a.label && a.label !== a.name ? `${a.label} ${a.path}` : a.path)),
      }
    if (s.assets?.length) out.assets = { count: s.assets.length, first: s.assets.slice(0, 3).map((a) => a.path) }
    else if (s.folders?.length) out.folders = s.folders.slice(0, 3)
    if (s.blueprint)
      out.blueprint = {
        path: s.blueprint.path,
        graph: s.blueprint.graph,
        nodes: (s.blueprint.nodes ?? []).slice(0, 5).map((n) => `${n.id} ${n.title}`),
      }
    return Object.keys(out).length ? out : { none: true }
  } catch (e) {
    return { error: (e as Error).message }
  }
}
