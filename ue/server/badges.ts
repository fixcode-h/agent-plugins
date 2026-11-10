import { readHistory } from './history.ts'
import { liveCards } from './instances.ts'
import { runOp, type OpCtx } from './ops.ts'
import { readLocal } from './store.ts'
import { liveKeys } from './undo.ts'

/**
 * 左栏分区旁边的数字（一个请求取全，网页 5 秒一次）：本次日志错误 / 警告数、监视几项、还在生效能撤回的修改、改了没保存的资源。
 * 每项单独兜底：某项取不到（UE 卡住、桥接旧）不影响其他项，也不当成错误弹给用户，数字不显示就是了
 */
export async function badges(ctx: OpCtx) {
  const p = ctx.project
  const cards = (await liveCards(p.root)).filter((c) => c.kind !== 'background')
  const quiet = <T>(x: Promise<T>) => x.catch(() => undefined)
  const [log, local, undoable, dirty] = await Promise.all([
    cards.length
      ? quiet(
          runOp(ctx, 'log.tail', { since: 1e15, limit: 1 }, 3000) as Promise<{ errors?: number; warnings?: number }>,
        )
      : undefined,
    quiet(readLocal(p.id)),
    quiet(liveKeys(p).then(async (isLive) => (await readHistory(p.id)).filter(isLive).length)),
    // 资源改动只暂存在编辑器（或后台编辑器）里；只有游戏进程时没有
    cards.some((c) => c.kind === 'editor')
      ? quiet(runOp(ctx, 'asset.dirty', {}, 3000).then((r) => ((r.items as unknown[]) ?? []).length))
      : undefined,
  ])
  return {
    errors: log?.errors,
    warnings: log?.warnings,
    watch: local?.watch.length ?? 0,
    undoable: undoable ?? 0,
    dirty: dirty ?? 0,
  }
}
