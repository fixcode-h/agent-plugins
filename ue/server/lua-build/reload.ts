import { runOp, type OpCtx } from '../ops.ts'
import { t } from '../util.ts'

/**
 * 编完自动重载（设计稿四.4「编完自动重载」）：调桥接的 lua.reload（UELink 2.4 加的，项目侧接入点 + require 兜底）。
 * UE 没开、桥接旧没有这个操作时不算编译失败，把原因写进输出，用户看得到（面板硬规则：错误一律显示）
 */
export async function reloadModules(ctx: OpCtx, modules: string[]) {
  try {
    const r = (await runOp(ctx, 'lua.reload', { modules }, 60000)) as {
      reloaded?: string[]
      failed?: { module: string; error: string }[]
    }
    const done = r.reloaded ?? modules
    const failed = r.failed ?? []
    if (failed.length)
      return {
        ok: false,
        modules: done,
        message: t('重载了 {n} 个模块，{m} 个失败：{list}', {
          n: done.length,
          m: failed.length,
          list: failed.map((f) => `${f.module}（${f.error}）`).join('；'),
        }),
      }
    return {
      ok: true,
      modules: done,
      message: t('已重载 {n} 个模块：{list}', { n: done.length, list: done.join(', ') }),
    }
  } catch (e) {
    return { ok: false, modules: [], message: t('没有自动重载：{msg}', { msg: (e as Error).message }) }
  }
}
