import { allBlocks } from '../../../../shared/gt-script/index.ts'
import { issue, type Check, type Issue } from './types.ts'

/**
 * 动作名和块的必填字段。编辑器没开时拿不到 gt.actions，按协议文档列的动作认（game-test.md 动作表 + 脚本协议第 2 节的块），
 * 不认识的只给警告：可选模块（CommonUI、GAS、EnhancedInput）和以后的版本会加动作，开着编辑器校验才算准
 */
const V1 = [
  'ping', 'mark', 'editor.ensure', 'pie.start', 'pie.stop', 'level.load', 'widget.add', 'widget.remove', 'find', 'snapshot',
  'wait', 'click', 'drag', 'wheel', 'type', 'select', 'scroll', 'screenshot', 'console', 'input.cursor', 'key', 'move',
  'actor.get', 'net.compare', 'assert', 'probe', 'stack.push', 'stack.pop', 'ability.input', 'input.start', 'input.stop', 'gm',
]
/** 录 UE 编辑器操作的回放（GameTest 1.11.0，只在开着界面的编辑器里跑；docs/game-test-script.md 第 15 节） */
const EDITOR = [
  'editor.open', 'editor.select', 'editor.prop', 'editor.spawn', 'editor.command', 'editor.save', 'editor.compile',
  'editor.click', 'editor.assert',
]
/** 块和新动作从数据层的注册表取（加块不用改这里），1.x 动作按文档 */
export const knownActions = () => new Set([...allBlocks().map((b) => b.action), ...V1, ...EDITOR])

const has = (o: Record<string, unknown>, k: string) => o[k] !== undefined && o[k] !== null && o[k] !== ''

export const actions: Check = {
  name: 'actions',
  summary: '动作名、if / loop / call / invoke / api / set 的必填字段',
  run({ steps }) {
    const out: Issue[] = []
    const known = knownActions()
    for (const s of steps) {
      const a = s.step.action
      if (typeof a !== 'string' || !a) {
        out.push(issue(s, 'unknown_action', '缺 action'))
        continue
      }
      if (!known.has(a))
        out.push(issue(s, 'unknown_action', `不认识的动作 ${a}（编辑器没开，按文档认的；可选模块的动作开着编辑器再校验）`, 'warning'))
      const o = s.step
      const need = (k: string, why: string) => !has(o, k) && out.push(issue(s, 'param_missing', `${a} 缺 ${k}：${why}`))
      if (a === 'if') need('cond', '统一条件')
      if (a === 'if' && !Array.isArray(o.then)) out.push(issue(s, 'bad_type', 'if 缺 then（成立时做的步骤数组）'))
      if (a === 'group' || a === 'loop') if (!Array.isArray(o.do)) out.push(issue(s, 'bad_type', `${a} 缺 do（步骤数组）`))
      if (a === 'loop') {
        const kinds = ['until', 'while', 'times', 'each', 'in'].filter((k) => has(o, k))
        if (!kinds.length) out.push(issue(s, 'param_missing', 'loop 要写 until / while / times / each / in 其中一个'))
        if (!has(o, 'times') && !has(o, 'max')) out.push(issue(s, 'loop_no_max', 'loop 要写 max（最多几轮，上限 1000），免得死循环'))
        if (typeof o.max === 'number' && (o.max < 1 || o.max > 1000)) out.push(issue(s, 'bad_type', 'max 要在 1–1000'))
      }
      if (a === 'call') need('script', '相对场景根的脚本路径')
      if (a === 'set' && !has(o, 'var')) need('var', '变量名')
      if (a === 'set' && !has(o, 'value') && !has(o, 'from')) out.push(issue(s, 'param_missing', 'set 要写 value 或 from'))
      if (a === 'invoke') need('function', '函数名')
      if (a === 'api') need('api', '接口名，如 Object.Find、项目.QuestTest.AcceptQuest')
      if ((a === 'widget.close' || a === 'widget.call') && !has(o, 'target')) need('target', '界面选择器，如 WBP_Guide:.')
      if (a === 'widget.call') need('function', '界面上的无参函数名')
      if (a === 'editor.open' && !has(o, 'asset') && !has(o, 'map'))
        out.push(issue(s, 'param_missing', 'editor.open 要写 asset（资源路径）或 map（关卡）'))
      if (a === 'editor.prop') for (const k of ['object', 'path'] as const) need(k, '对象（actor:<标签> 或资源路径）和属性路径')
      if (a === 'editor.prop' && !('value' in o)) out.push(issue(s, 'param_missing', 'editor.prop 缺 value'))
      if (a === 'editor.spawn') need('class', '类或蓝图路径')
      if (a === 'editor.compile') need('asset', '蓝图路径')
      if (a === 'editor.command' && !has(o, 'name') && !has(o, 'console'))
        out.push(issue(s, 'param_missing', 'editor.command 要写 name（Ctx.Command）或 console'))
      if (a === 'editor.click') need('widget', 'Slate 类型名，录制时自动填')
      if (a === 'editor.assert' && !has(o, 'widget') && !has(o, 'check'))
        out.push(issue(s, 'param_missing', 'editor.assert 要写 widget（界面上有某个控件）或 check + asset'))
      if ((a === 'break' || a === 'continue') && !s.path.includes('.do.'))
        out.push(issue(s, 'bad_type', `${a} 只能写在 loop 里`))
    }
    return out
  },
}
