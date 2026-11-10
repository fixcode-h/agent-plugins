import { undo } from './actions.ts'
import { readHistory } from './history.ts'
import { info, liveCards } from './instances.ts'
import type { OpCtx } from './ops.ts'
import type { HistoryItem, UeProject } from './types.ts'

/**
 * 「还在生效」的运行时修改：能撤回、没撤回过，当时的进程还在、当时的世界（PIE 世界）也还在。
 * PIE 停了世界就没了，改的值跟着消失，不算还在生效（撤回也会失败），所以不列进一键撤回。
 */
export async function liveKeys(p: UeProject) {
  const cards = (await liveCards(p.root)).filter((c) => c.kind !== 'background')
  const insts = await Promise.all(cards.map(info))
  const worlds = new Map(insts.map((i) => [i.pid, new Set(i.worlds.map((w) => w.id))]))
  return (it: HistoryItem) =>
    !!it.ok &&
    !!it.undo &&
    !it.undone &&
    it.pid !== undefined &&
    worlds.has(it.pid) &&
    (!it.world || !!worlds.get(it.pid)?.has(it.world))
}

/** 网页的操作记录：每条带上 live（还在生效、能撤回） */
export async function historyWithLive(p: UeProject) {
  const isLive = await liveKeys(p)
  return (await readHistory(p.id))
    .slice(-1000)
    .reverse()
    .map((it) => ({ ...it, live: isLive(it) }))
}

/**
 * 一键撤回还在生效的运行时修改：从新到旧一条条撤（同一个属性改了几次时，最后撤最早那条，回到最初的值）。
 * 某条失败不停下，最后把失败的原样列出来（面板硬规则：错误给用户看）
 */
export async function undoAll(ctx: OpCtx) {
  const isLive = await liveKeys(ctx.project)
  const items = (await readHistory(ctx.project.id)).filter(isLive).reverse()
  const failed: { id: string; summary: string; error: string }[] = []
  let done = 0
  for (const it of items) {
    try {
      await undo(ctx, it.id)
      done++
    } catch (e) {
      failed.push({ id: it.id, summary: it.summary, error: (e as Error).message })
    }
  }
  return { done, failed }
}
