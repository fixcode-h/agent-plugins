import { runOp, type OpCtx } from '../ops.ts'
import { t } from '../util.ts'
import { listSnippets } from './snippets.ts'

/**
 * 按名字执行片段：Agent 只能执行你批准过的（批准过的不再逐次确认，但 UE 页「权限与设置」里运行时只读时照样拦），
 * 你在网页上点的直接执行。都照常记进操作记录
 */
export async function runSnippet(ctx: OpCtx, name: string, timeoutMs = 10000) {
  const { items } = await listSnippets(ctx.project)
  const s = items.find((x) => x.name === name)
  const names = items.map((x) => (x.approved ? `${x.name}（已批准）` : x.name))
  if (!s)
    throw new Error(
      names.length
        ? t('没有叫「{name}」的 Lua 片段。现有的：{list}', { name, list: names.join('、') })
        : t('这个项目还没有 Lua 片段：在 UE 页 Lua →「执行」里把常用代码存成片段并批准'),
    )
  if (ctx.actor.kind === 'agent' && !s.approved)
    throw new Error(
      t(
        '片段「{name}」还没批准（或批准后代码改过）：请用户在 UE 页 Lua →「执行」里批准，或改用 code 执行（会请用户确认）',
        {
          name,
        },
      ),
    )
  return runOp(
    { ...ctx, approvedLua: s.code },
    'lua.exec',
    { code: s.code, path: s.self ?? '', timeoutMs, snippet: s.name },
    timeoutMs + 10000,
  )
}
