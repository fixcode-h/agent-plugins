import { runOp, type OpCtx } from '../ops.ts'
import { tryOp } from './live.ts'
import { iniTags, type TagRow } from './tag-ini.ts'

/**
 * GameplayTag 树（设计稿「UE 插件优化与扩展」二 P2）：有进程时用 UELink 的 tags.list（含 C++ 原生的、DataTable 里的），
 * 没有时读项目和插件的 Tag ini（DefaultGameplayTags.ini、Config/Tags/*.ini），注释只在 ini 里有，两边合起来。
 * 「谁引用了这个 Tag」只有资源注册表知道，要 UE（编辑器没开时走后台编辑器）。
 */
export async function listTags(ctx: OpCtx, filter = '') {
  const disk = await iniTags(ctx.project.root)
  const live = await tryOp<{ items: TagRow[]; total: number }>(ctx, 'tags.list', { filter })
  const f = filter.toLowerCase()
  if (live.data) {
    const comments = new Map(disk.map((d) => [d.tag, d.comment]))
    const items = live.data.items.map((i) => ({ ...i, ...(comments.get(i.tag) && { comment: comments.get(i.tag) }) }))
    return { items, total: live.data.total, live: true, pid: live.data.instance?.pid }
  }
  const items = disk.filter((d) => !f || d.tag.toLowerCase().includes(f))
  return { items, total: items.length, live: false, note: live.error }
}

export async function tagRefs(ctx: OpCtx, tag: string) {
  return runOp(ctx, 'tags.refs', { tag, limit: 500 }, 60000)
}
