import { customKey } from '../../shared/gm/schema.ts'
import type { OpCtx } from '../ops.ts'
import { objLibFile } from '../obj-lib/store.ts'
import { gmFile, readGm, writeGm } from '../store.ts'

/**
 * ue_gm action=remove（规格第 9 节）：kind=gm 删一条自定义 GM（名字或 id），kind=object 删对象列表里的一项。
 * 被宏用着的 GM 照样删，但在返回里列出是哪些宏（那几步执行时会报「没有这个自定义 GM」，让 Agent 告诉用户或改宏）；
 * 常用里的一起去掉。已经保存的自定义 GM 带着自己的对象副本，删对象列表里的项不影响它们
 */
export async function removeGmDef(ctx: OpCtx, a: Record<string, unknown>) {
  const name = String(a.name ?? '').trim()
  if (!name) throw new Error('remove 要写 name（自定义 GM 的名字或 id、对象列表里的对象名）')
  const g = await readGm(ctx.project)
  if (a.kind === 'object') {
    if (!g.objects.some((o) => o.name === name)) throw new Error(`对象列表里没有「${name}」`)
    const key = `obj:${name}`
    await writeGm(ctx.project, {
      ...g,
      objects: g.objects.filter((o) => o.name !== name),
      common: g.common.filter((f) => f.key !== key),
    })
    return { removed: true, object: name, file: objLibFile(ctx.project) }
  }
  if (a.kind !== 'gm') throw new Error('remove 的 kind 写 gm（自定义 GM）或 object（对象列表）')
  const c = g.custom.find((x) => x.id === name) ?? g.custom.find((x) => x.name === name)
  if (!c) throw new Error(`没有这个自定义 GM：${name}（ue_gm action=list source=custom 列出全部）`)
  const key = customKey(c.id)
  const usedBy = g.macros.filter((m) => m.steps.some((s) => s.custom === c.id)).map((m) => m.name)
  await writeGm(ctx.project, {
    ...g,
    custom: g.custom.filter((x) => x.id !== c.id),
    common: g.common.filter((f) => f.key !== key),
  })
  return {
    removed: true,
    gm: c.name,
    ...(usedBy.length
      ? { usedByMacros: usedBy, note: '这些宏里调它的那几步执行时会失败，告诉用户或把那几步去掉' }
      : {}),
    file: gmFile(ctx.project),
  }
}
