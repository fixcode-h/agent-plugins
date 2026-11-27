import { issue } from '../types.ts'
import { isObj, type StyleRule } from './ctx.ts'

/** 主流程很长又没分段：画布和报告里是一长串节点，看不出哪几步属于哪个测试点 */
const MAX = 15

export const flatLong: StyleRule = {
  name: 'flat-long',
  run({ env }) {
    const steps = Array.isArray(env.doc.steps) ? env.doc.steps.filter(isObj) : []
    if (steps.length <= MAX || steps.some((s) => s.action === 'group' || s.action === 'call')) return []
    return [
      issue(
        { step: {}, path: 'steps', inGuard: false },
        'style_flat_long',
        `主流程 ${steps.length} 步平铺：按阶段包成 group（准备、进入玩法、每个测试点一段、收尾），group 的 title 写阶段名；同一时刻的几项检查合成一个 assert`,
        'warning',
      ),
    ]
  },
}
