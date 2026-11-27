import { cleanupRun, precheckRun, type GtScript, type GtStep } from '../../../../../shared/gt-script/index.ts'
import { issue, type Issue } from '../types.ts'
import type { StyleRule } from './ctx.ts'

/**
 * 三段分得不对（GameTest 2.8.0）：执行段开头只是准备和检查前置 → 挪到执行前（setup），缺配置时报「前置不满足」而不是测试失败；
 * 执行段末尾只是收拾现场 → 挪到执行后（teardown），失败、停止也会做
 */
export const phaseSplit: StyleRule = {
  name: 'phase-split',
  run(c) {
    const doc = c.env.doc as GtScript
    const out: Issue[] = []
    const at = (i: number) => ({
      step: (doc.steps?.[i] ?? {}) as GtStep & Record<string, unknown>,
      path: `steps.${i}`,
      inGuard: false,
    })
    const pre = precheckRun(doc)
    if (pre)
      out.push(
        issue(
          at(0),
          'style_precheck_in_steps',
          `执行段（steps）开头 ${pre} 步只是在准备环境、检查前置，还没开始操作：挪到执行前（setup，分「准备环境」「前置检测」两个 group）。执行前没通过会报「前置不满足」，Agent 去补前置而不是改脚本`,
          'warning',
        ),
      )
    const post = cleanupRun(doc)
    if (post)
      out.push(
        issue(
          at((doc.steps?.length ?? 0) - post),
          'style_cleanup_in_steps',
          `执行段（steps）末尾 ${post} 步是在收拾现场（退出、关闭、恢复）：挪到执行后（teardown），跑失败、按停止也会做，下一份脚本从干净状态开始`,
          'warning',
        ),
      )
    return out
  },
}
