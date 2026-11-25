import { getQuery, invokesOf, mergeArgs, stepOf, stepOk } from '../../shared/gm/custom.ts'
import type { GmCustom, GmStore } from '../../shared/gm/schema.ts'
import { BridgeError } from '../instances.ts'
import { runOp, type OpCtx } from '../ops.ts'
import { readGm } from '../store.ts'
import { t } from '../util.ts'

/** 按 id 或名字找自定义 GM（Agent 多半写名字，宏里存的是 id） */
export const findCustom = (g: GmStore, idOrName: string) =>
  g.custom.find((c) => c.id === idOrName) ?? g.custom.find((c) => c.name === idOrName)

/**
 * 执行一条自定义 GM（ue_gm run source=custom、宏里的一步）：拼法在 shared/gm/custom.ts，和 GM 页同一份。
 * kind=call 走 gt.step 跑一步 obj.call（带 objects），kind=set 跑一步 obj.set；kind=get 走 gt.resolve 带 show 拿每个实例的属性值。
 * 成败只看 gt.step 的 ok / status（规格第 7 节），失败时把它的 message 原样抛出（不重试）
 */
export async function runCustom(ctx: OpCtx, idOrName: string, override?: Record<string, unknown>) {
  const g = await readGm(ctx.project)
  const c = findCustom(g, idOrName)
  if (!c)
    throw new BridgeError(
      t('没有这个自定义 GM：{name}（ue_gm action=list source=custom 列出全部）', { name: idOrName }),
    )
  return runCustomDef(ctx, c, override)
}

export async function runCustomDef(ctx: OpCtx, c: GmCustom, override?: Record<string, unknown>) {
  if (c.kind === 'get') {
    const r = await runOp(ctx, 'gt.resolve', getQuery(c), 20000)
    const item = ((r.refs as { id: string; count?: number; candidates?: unknown[]; error?: string }[]) ?? [])[0]
    if (item?.error) throw new BridgeError(item.error)
    return { ok: true, gm: c.name, count: item?.count ?? 0, items: item?.candidates ?? [] }
  }
  const args = mergeArgs(c, override)
  const { step, objects } = stepOf(c, args)
  const res = await runOp(ctx, 'gt.step', { step, objects }, 60000)
  const invoke = invokesOf(res)
  if (!stepOk(res))
    throw new BridgeError(
      String(
        (res as { message?: unknown }).message ||
          t('自定义 GM「{name}」没执行成功（{s}）', { name: c.name, s: String(res.status ?? '') }),
      ),
    )
  return {
    ok: true,
    gm: c.name,
    status: res.status,
    ...(c.kind === 'set' ? { set: { prop: c.prop, value: args.value } } : { invoke }),
    ...(res.message ? { message: res.message } : {}),
  }
}
