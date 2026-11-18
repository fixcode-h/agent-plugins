import { issue, type Check, type Issue } from './types.ts'

/** 步骤 id：字母数字下划线、场景内唯一（报告、断点、from / to 都按它） */
export const ids: Check = {
  name: 'ids',
  summary: '步骤 id 的写法和是否重复',
  run({ steps, doc }) {
    const out: Issue[] = []
    const seen = new Map<string, string>()
    const guards = Array.isArray(doc.guards) ? (doc.guards as Record<string, unknown>[]) : []
    const all = [
      ...guards.map((g, i) => ({ step: g ?? {}, path: `guards.${i}`, inGuard: true })),
      ...steps,
    ]
    for (const s of all) {
      const id = s.step.id
      if (id === undefined) continue
      if (typeof id !== 'string' || !/^\w+$/.test(id)) {
        out.push(issue(s, 'bad_type', `id 只能是字母数字下划线：${JSON.stringify(id)}`))
        continue
      }
      const prev = seen.get(id)
      if (prev) out.push(issue(s, 'dup_id', `id ${id} 和 ${prev} 重复`))
      else seen.set(id, s.path)
    }
    return out
  },
}
