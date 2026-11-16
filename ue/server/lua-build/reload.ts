import { runOp, type OpCtx } from '../ops.ts'
import { t } from '../util.ts'

/**
 * 编完自动重载（设计稿四.4「编完自动重载」）：调桥接的 lua.reload（UELink 2.4，项目侧 SetReloader 接入点 + require 兜底）。
 * 只重载这次编过、而且游戏里已经加载了的模块：没加载的模块用到时自然读新文件，用 require 兜底去重载反而会提前加载它、跑它的初始化。
 * UE 没开、桥接旧没有这个操作时不算编译失败，把原因写进输出，用户看得到（面板硬规则：错误一律显示）
 */
interface ReloadItem {
  module: string
  ok: boolean
  mode?: string
  error?: string
}

export async function reloadModules(ctx: OpCtx, modules: string[]) {
  try {
    let wanted = [...new Set(modules)]
    let skipped = 0
    try {
      const m = (await runOp(ctx, 'lua.modules', { limit: 5000 })) as { items?: { name: string }[] }
      const loaded = new Set((m.items ?? []).map((x) => x.name))
      const next = wanted.filter((x) => loaded.has(x))
      skipped = wanted.length - next.length
      wanted = next
    } catch {
      // 列不出模块（桥接旧）时照原样交给 lua.reload，由它报不支持
    }
    if (!wanted.length)
      return { ok: true, modules: [], message: t('编过的 {n} 个模块游戏里都还没加载，不用重载', { n: skipped }) }
    const r = (await runOp(ctx, 'lua.reload', { modules: wanted }, 60000)) as { items?: ReloadItem[]; note?: string }
    const items = r.items ?? []
    const done = items.filter((x) => x.ok).map((x) => x.module)
    const failed = items.filter((x) => !x.ok)
    const tail = [skipped ? t('{n} 个没加载的跳过', { n: skipped }) : '', r.note ?? ''].filter(Boolean)
    const message = failed.length
      ? t('重载了 {n} 个模块，{m} 个失败：{list}', {
          n: done.length,
          m: failed.length,
          list: failed.map((f) => `${f.module}（${f.error ?? ''}）`).join('；'),
        })
      : t('已重载 {n} 个模块：{list}', { n: done.length, list: done.join(', ') })
    return { ok: !failed.length, modules: done, message: [message, ...tail].join('。') }
  } catch (e) {
    return { ok: false, modules: [], message: t('没有自动重载：{msg}', { msg: (e as Error).message }) }
  }
}
