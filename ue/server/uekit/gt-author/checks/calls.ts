import { flatSteps } from '../walk.ts'
import { issue, type Check, type Issue } from './types.ts'

/** call 的目标在不在、会不会成环（A call B、B 又 call A）、参数对不对得上，和 GameTest 加载时查的一样 */
export const norm = (p: string) =>
  p
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\.json$/i, '')
    .toLowerCase()

export const calls: Check = {
  name: 'calls',
  summary: 'call 的目标脚本存在、不成环、传的参数对得上',
  async run(env) {
    const out: Issue[] = []
    for (const s of env.steps) {
      if (s.step.action !== 'call' || typeof s.step.script !== 'string') continue
      const target = s.step.script
      const doc = await env.loadScript(target)
      if (!doc) {
        out.push(issue(s, 'call_missing', `找不到要调用的脚本 ${target}（相对场景根，.json 可省）`))
        continue
      }
      // 传了对方没声明的参数：多半是名字拼错；对方要的参数没给、也没默认值：运行时会失败
      const params = (doc.params && typeof doc.params === 'object' ? doc.params : {}) as Record<string, unknown>
      const given = (s.step.with && typeof s.step.with === 'object' ? s.step.with : {}) as Record<string, unknown>
      for (const k of Object.keys(given))
        if (!(k in params))
          out.push(issue(s, 'param_missing', `${target} 没有参数 ${k}（有：${Object.keys(params).join('、') || '无'}）`))
      for (const [k, p] of Object.entries(params))
        if (!(k in given) && !(p && typeof p === 'object' && 'default' in p))
          out.push(issue(s, 'param_missing', `调用 ${target} 没给参数 ${k}，它也没有默认值`))
      const cycle = await findCycle(env.loadScript, norm(target), env.self ? [norm(env.self)] : [])
      if (cycle) out.push(issue(s, 'call_cycle', `调用成环：${cycle.join(' → ')}`))
    }
    return out
  },
}

async function findCycle(
  load: (rel: string) => Promise<Record<string, unknown> | undefined>,
  at: string,
  chain: string[],
  depth = 0,
): Promise<string[] | undefined> {
  if (chain.includes(at)) return [...chain, at]
  if (depth > 16) return undefined
  const doc = await load(at)
  if (!doc) return undefined
  for (const s of flatSteps(doc)) {
    if (s.step.action !== 'call' || typeof s.step.script !== 'string') continue
    const hit = await findCycle(load, norm(s.step.script), [...chain, at], depth + 1)
    if (hit) return hit
  }
  return undefined
}
