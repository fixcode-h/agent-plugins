import { readLibrarySteps } from '../../library.ts'
import { issue, type Issue } from '../types.ts'
import { inRecorded, label, sameStep, type StyleRule } from './ctx.ts'

/**
 * 脚本里有一段和公共库（common/）某份子脚本的主流程一模一样：改成 call 它，公共段只维护一份。
 * 只比没有参数的子脚本和整段相同的情况——带参数的值会被换成 $参数，逐字比不出来，交给 Agent 看 look what=library 判断
 */
const MIN = 2

export const libraryMatch: StyleRule = {
  name: 'library-match',
  async run({ env, slots }) {
    const lib = (await readLibrarySteps(env.scenarioRoot)).filter(
      (x) =>
        x.steps.length >= MIN &&
        x.script.toLowerCase() !==
          env.self
            .replace(/\\/g, '/')
            .replace(/\.json$/i, '')
            .toLowerCase(),
    )
    if (!lib.length) return []
    const out: Issue[] = []
    for (const rows of slots.values())
      for (let i = 0; i < rows.length; i++) {
        if (inRecorded(rows[i])) continue
        const hit = lib.find(
          (x) => i + x.steps.length <= rows.length && x.steps.every((s, k) => sameStep(rows[i + k].step, s)),
        )
        if (!hit) continue
        const end = rows[i + hit.steps.length - 1]
        out.push(
          issue(
            rows[i],
            'style_library_match',
            `${label(rows[i])}–${label(end)} 和公共库 ${hit.script} 一样：换成一步 {"action": "call", "script": "${hit.script}"}`,
            'warning',
          ),
        )
        i += hit.steps.length - 1
      }
    return out
  },
}
