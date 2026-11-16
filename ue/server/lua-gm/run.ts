import { BridgeError } from '../instances.ts'
import { runOp, type OpCtx } from '../ops.ts'
import { t } from '../util.ts'
import { current } from './scan.ts'
import { luaCall } from './call.ts'

/**
 * 执行一条 Lua GM：按扫描结果生成代码，经 lua.gm（桥接上就是 lua.exec）执行。
 * 和任意 Lua 代码不同：代码是面板按扫出来的 GM 拼的，Agent 调用按「运行时」权限走，不每次确认（设计稿 4.2）
 */
export async function runLuaGm(ctx: OpCtx, name: string, args: unknown[] = []): Promise<Record<string, unknown>> {
  const scan = await current(ctx.project)
  const it = scan.items.find((x) => x.name === name)
  if (!it) {
    if (scan.error) throw new BridgeError(t('Lua GM 扫描出错，先修好扫描脚本：{msg}', { msg: scan.error }))
    throw new BridgeError(t('没有这个 Lua GM：{name}（GM 页「Lua」来源里能看到全部）', { name }))
  }
  const code = luaCall(it, args)
  const res = await runOp(ctx, 'lua.gm', { code, name, args, timeoutMs: 10000 }, 20000)
  return { ...res, code }
}
