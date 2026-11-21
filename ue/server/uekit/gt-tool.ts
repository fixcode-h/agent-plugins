import type { McpResult } from '../../../sdk/server.ts'
import { runOp } from '../ops.ts'
import { out, str, tool } from '../toolkit.ts'
import { gtApi, gtValidate, gtVars, gtWidgets, STRUCT_MAX } from './gt-author/tool-actions.ts'
import { gtProps } from './gt-ref/tool.ts'
import { gtVerdict } from './gt-verdict.ts'

/**
 * ue_gametest（面板 ADR 0067：GameTest 一个工具，同一对象的操作用 action 区分）。从 tools-ext.ts 分出来：
 * 脚本化（GameTest 1.9.0）加了 vars / widgets / api / validate 四个查和校验的 action（定稿 11 节），
 * 对象引用（GameTest 2.0.0，协议 game-test-ref）加了 props（属性树和推荐标识）；migrate 随 v5 删掉（旧脚本不迁移），
 * 实现在 gt-author/、gt-ref/，这里只做分发。怎么写 v5 脚本放在技能 ue-gametest-authoring 里，说明只写各 action 做什么，免得超长。
 */
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d)

/** gt.run 的参数：批量（tag / scenarios）、场景文件、临时步骤三选一 */
function runArgs(a: Record<string, unknown>) {
  const delay = a.stepDelayMs !== undefined ? { stepDelayMs: num(a.stepDelayMs, 0) } : {}
  if (a.tag) return { tag: a.tag, ...(a.name ? { name: a.name } : {}) }
  if (Array.isArray(a.scenarios) && a.scenarios.length)
    return { scenarios: a.scenarios, ...(a.name ? { name: a.name } : {}) }
  const all = a.ignoreSkipIf === true ? { ignoreSkipIf: true } : {}
  const v3 = Object.fromEntries(['params', 'from', 'to'].filter((k) => a[k] !== undefined).map((k) => [k, a[k]]))
  if (a.scenario) return { scenario: a.scenario, ...delay, ...all, ...v3 }
  return { steps: a.steps ?? [], name: a.name || 'agent', ...delay, ...all }
}

const withVerdict = (r: McpResult, verified: McpResult['verified']) => (verified ? { ...r, verified } : r)

type Op = (name: string, args?: Record<string, unknown>, timeout?: number) => Promise<Record<string, unknown>>

/**
 * ue_gametest action=history：给 scenario 是这个场景的历史；不给时再带上这次会话最近的 run（gt.runs），
 * 临时步骤不进按场景的历史，Agent 只能从这里找回 runId。编辑器没开时 gt.runs 拿不到，只回历史
 */
async function gtHistory(op: Op, a: Record<string, unknown>) {
  if (a.scenario) return op('gt.history', { scenario: a.scenario })
  const [history, runs] = await Promise.all([op('gt.history', {}), op('gt.runs', {}).catch(() => undefined)])
  return runs ? { ...history, recentRuns: runs.runs ?? runs } : history
}

export const GT_TOOL = tool(
  'ue_gametest',
  'GameTest：在 PIE / 游戏进程里跑 UI 和玩法测试脚本（场景根下的 JSON，status 返回位置；v5 脚本（schemaVersion 5）用对象引用 {class, in?, ident} 指对象（class 可写 lua:模块名，in 可写数组）、{obj, part} 指部件，ident 每项都要满足、也可写条件组 {any|all: […], not?}，属性路径 @/子控件.属性、@.属性、@.取值函数(常量参数)、@#Lua字段、@:状态，有 if / loop / call / set / obj.* / api / 守护 / 表达式，写法按技能 ue-gametest-authoring）。' +
    '从代码写测试：props 看对象的属性树和推荐标识（给 class 不用开游戏，给 target / object 要开着）→ widgets 读 WBP 控件树拿部件名 → vars 列变量和函数签名（scope=widget|class|subsystem|player|object|lua）→ api 列接口库 → 写脚本 → validate 校验（编辑器没开时只查结构，offline）→ run → job / report。旧版本脚本不再支持也不迁移，validate 报 schema_old / path_old 时按新写法重写。' +
    'run：scenario（可带 params、from / to 步骤 id）、steps + name 或批量 tag / scenarios，马上返回编号；step 执行一步；resolve 核对引用命中几个和 skipIf（要开着 PIE）；inspect 看视口某点是什么、给出引用；actions 列动作；scenarios 列场景；job 看进度；report 取报告，失败步骤的 payload.evidence 有截图、控件快照、日志路径；history 看最近结果；stop 取消。' +
    '编辑器没开时 scenarios / report / history 读磁盘（offline: true）。跑场景文件通过的 report / job 算进完成依据。',
  {
    action: {
      type: 'string',
      enum: [
        'status',
        'actions',
        'vars',
        'widgets',
        'api',
        'validate',
        'props',
        'scenarios',
        'run',
        'step',
        'resolve',
        'inspect',
        'job',
        'report',
        'history',
        'stop',
      ],
    },
    scenario: { type: 'string', description: '场景文件，相对场景根' },
    script: { type: 'object', description: 'validate：整份脚本 JSON（还没存文件时）' },
    steps: { type: 'array', items: { type: 'object' }, description: 'run：临时步骤' },
    params: { type: 'object', description: 'run：脚本参数' },
    from: { type: 'string', description: 'run：从这个步骤 id 开始' },
    to: { type: 'string', description: 'run：跑到这个步骤 id 停下' },
    tag: { type: 'string' },
    scenarios: { type: 'array', items: { type: 'string' } },
    refs: { type: 'array', items: { type: 'object' }, description: 'resolve：[{id?, ref}] 看命中几个' },
    checks: { type: 'array', items: { type: 'object' }, description: 'resolve：带 skipIf 的步骤' },
    ignoreSkipIf: { type: 'boolean' },
    name: { type: 'string' },
    step: { type: 'object', description: 'step：{action, target?, …}' },
    stepDelayMs: { type: 'number' },
    scope: { type: 'string', description: 'vars：widget / class / subsystem / player / object / lua' },
    target: { type: 'object', description: 'vars / props：{obj: 引用, part?}' },
    object: { description: 'vars / props：对象引用' },
    class: { type: 'string', description: 'vars / widgets / props' },
    part: { type: 'string', description: 'props：只看这个部件' },
    module: { type: 'string', description: 'vars scope=lua / props：Lua require 路径' },
    which: { type: 'string', description: 'vars scope=player：gi gs gm ps pc pawn hud' },
    asset: { type: 'string', description: 'widgets：WBP 资产路径 /Game/UI/WBP_Bag' },
    values: { type: 'boolean' },
    filter: { type: 'string' },
    query: { type: 'string' },
    src: { type: 'string', description: 'api：builtin / cpp / lua' },
    readOnly: { type: 'boolean', description: 'api：只列只读的' },
    rescan: { type: 'boolean', description: 'api：重扫 C++ 接口' },
    offset: { type: 'number' },
    limit: { type: 'number' },
    runId: { type: 'string' },
    last: { type: 'number', description: 'job：只回最后几步' },
    x: { type: 'number', description: 'inspect：视口归一化坐标 0–1' },
    y: { type: 'number' },
  },
  ['action'],
  async (a, ctx) => {
    const op: Op = (name, args = {}, timeout = 60000) => runOp(ctx, name, args, timeout)
    switch (a.action) {
      case 'status':
        return out(await op('gt.health'))
      case 'actions':
        return out(await op('gt.actions'))
      case 'vars':
        return out(await gtVars(op, a, ctx))
      case 'widgets':
        return out(await gtWidgets(op, a, ctx))
      case 'api':
        return out(await gtApi(op, a, ctx))
      case 'validate':
        return out(await gtValidate(op, a, ctx))
      case 'props':
        return out(await gtProps(op, a), STRUCT_MAX)
      case 'migrate':
        // v5 起不迁移（用户 2026-11-21）：旧调用给一句改用什么
        return out({
          error: 'migrate 已删除：旧格式不再支持，请按新写法重写（schemaVersion 5，路径写法见 validate 报的 path_old）',
        })
      case 'scenarios':
        return out(await op('gt.scenarios', { query: a.query, limit: 100 }))
      case 'run':
        return out(await op('gt.run', runArgs(a)))
      case 'step':
        return out(await op('gt.step', { step: a.step ?? {} }, 120000))
      case 'resolve':
        return out(
          await op('gt.resolve', {
            ...(a.scenario ? { scenario: a.scenario } : {}),
            ...(Array.isArray(a.refs) ? { refs: a.refs } : {}),
            ...(Array.isArray(a.checks) ? { checks: a.checks } : {}),
          }),
        )
      case 'inspect':
        return out(
          await op('gt.inspect', a.x !== undefined && a.y !== undefined ? { x: num(a.x, 0.5), y: num(a.y, 0.5) } : {}),
        )
      case 'job': {
        const job = await op('gt.job', { steps: num(a.last, 20) })
        return withVerdict(out(job), gtVerdict(job))
      }
      case 'report': {
        const report = await op('gt.report', { runId: a.runId })
        return withVerdict(out(report), gtVerdict(report))
      }
      case 'history':
        return out(await gtHistory(op, a))
      case 'stop':
        return out(await op('gt.stop'))
      default:
        return out({ error: `不认识的 action：${str(a.action)}` })
    }
  },
  // 跑通过的场景算进完成依据（和 ue_compile 同一套）：只读的 action 不会被守卫挡，verified 只在有结论时给
  { effect: 'verify' },
)
