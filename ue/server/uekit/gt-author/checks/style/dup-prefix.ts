import { issue } from '../types.ts'
import { isObj, sameStep, type StyleRule } from './ctx.ts'

/**
 * 和同目录别的脚本开头一样的一段（准备 NPC、清状态、进玩法）：复制粘贴的准备步骤一处改了别处忘改，
 * 提成 common/ 下带 params 的子脚本用 call，或者放进 setup
 */
const MIN = 4

export const dupPrefix: StyleRule = {
  name: 'dup-prefix',
  async run({ env, siblings }) {
    const mine = lead(env.doc)
    if (mine.length < MIN) return []
    let best = { n: 0, rel: '' }
    for (const s of await siblings()) {
      const other = lead(s.doc)
      let n = 0
      while (n < mine.length && n < other.length && sameStep(mine[n], other[n])) n++
      if (n > best.n) best = { n, rel: s.rel }
    }
    if (best.n < MIN) return []
    return [
      issue(
        { step: {}, path: 'steps', inGuard: false },
        'style_dup_prefix',
        `开头 ${best.n} 步和 ${best.rel} 一样：这段和被测功能无关、别的测试也会走的话，提进本项目公共库 common/<功能>/<名字>.json（写 title、note，不同的值写成 params），两份脚本都改成一步 {"action": "call", "script": "common/<功能>/<名字>", "with": {…}}；只属于这个功能的准备放进 setup`,
        'warning',
      ),
    ]
  },
}

/** setup + steps 拼起来比：一份放 setup、一份放 steps 的也算重复 */
function lead(doc: Record<string, unknown>) {
  const pick = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : [])
  return [...pick(doc.setup), ...pick(doc.steps)]
}
