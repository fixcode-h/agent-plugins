import type { OpCtx } from '../ops.ts'
import { out, tool } from '../toolkit.ts'
import { t } from '../util.ts'
import { vsCall } from './connect.ts'
import { openVs } from './open-vs.ts'
import { BP_OPS, INSPECT_OPS, SESSION_OPS, VsDebugError } from './protocol.ts'

/**
 * 通过 VS 调试 UE 的 Agent 工具（UEToVS 0.8.0 的调试控制管道，协议见 UEToVS docs/design/VS-调试控制.md）。
 * 按对象分三个工具（面板 ADR 0067：同一对象的操作用 action，一个工具不超过 10 个）：会话、断点、停下后的检视。
 * 参数除 action 外原样转给 VS，校验和中文报错由 UEToVS 做，这里不另写一套
 */
type Args = Record<string, unknown>

/** 去掉 action，其余原样作为 args（undefined 的不发） */
const rest = (a: Args) => Object.fromEntries(Object.entries(a).filter(([k, v]) => k !== 'action' && v !== undefined))

async function confirmKill(ctx: OpCtx, title: string) {
  // 结束 UE 进程会丢掉编辑器里没保存的改动：不管权限设成什么都先问（和危险控制台命令一样走对话里的确认卡片）
  if (!ctx.confirm) throw new VsDebugError(t('这一步要你确认，但这次调用不在对话里，没法弹出确认卡片'))
  const r = await ctx.confirm({ title, detail: t('VS 启动的 UE 进程会被结束，编辑器里没保存的改动会丢失。') })
  if (!r.allow) throw new VsDebugError(t('你拒绝了：{msg}', { msg: r.message || title }))
}

const FRAME_PROPS = {
  thread: { type: 'number', description: '线程 ID（threads 返回的 id），不填用当前线程' },
  frame: { type: 'number', description: '帧号，0 是栈顶' },
}

export const VS_TOOLS = [
  tool(
    'ue_vs_debug',
    '通过 VS 自带的调试器启停和控制 UE（要 VS 里装 UEToVS 0.8.0+）。action=status 看调试状态（mode design / run / break、停在哪、编译状态，frames 取几帧栈）；' +
      'start 等于 F5（VS 先 UBT 编译再启动；configuration 切配置如 DebugGame Editor，project 切启动项目，noDebug=true 不挂调试器，map / game=true / args 只对这一次启动生效）；' +
      'stop 停止调试并结束 UE（detach=true 只断开、UE 继续跑）；restart 重启调试；attach 附加到已在跑的 UE（pid，或 name 默认 UnrealEditor）；' +
      'build 只编译启动项目（之后 wait 看 buildDone / buildFailed 和 buildErrors）；pause 全部中断；continue 继续（waitMs>0 等下一次停下）；' +
      'step 单步（kind=into / over / out / toLine，toLine 给 file+line；默认等到停下返回新位置）；wait 等到停下 / 退出 / 编译完（timeoutMs 最多 120000，默认 30000）。' +
      'VS 没开时 start / attach / build 会先打开 VS 和解决方案（最多等 3 分钟）。stop / restart 会请用户确认。',
    {
      action: { type: 'string', enum: [...SESSION_OPS] },
      configuration: {
        type: 'string',
        description: 'start / build：解决方案配置，如 Development Editor、DebugGame Editor',
      },
      project: { type: 'string', description: 'start / build：启动项目名' },
      noDebug: { type: 'boolean' },
      map: { type: 'string', description: 'start：启动地图，如 /Game/Maps/Test' },
      game: { type: 'boolean', description: 'start：加 -game 启动独立游戏进程' },
      args: { type: 'string', description: 'start：追加的命令行参数，如 -log -windowed' },
      detach: { type: 'boolean' },
      pid: { type: 'number' },
      name: { type: 'string' },
      kind: { type: 'string', enum: ['into', 'over', 'out', 'toLine'] },
      file: { type: 'string' },
      line: { type: 'number' },
      waitMs: { type: 'number' },
      timeoutMs: { type: 'number' },
      frames: { type: 'number' },
    },
    ['action'],
    async (a, ctx) => {
      const op = String(a.action ?? '')
      if (!(SESSION_OPS as readonly string[]).includes(op)) throw new VsDebugError(t('不认识的 action：{a}', { a: op }))
      if (op === 'restart') await confirmKill(ctx, t('Agent 要重启 VS 调试（结束 UE 进程再重新启动）'))
      if (op === 'stop' && a.detach !== true) await confirmKill(ctx, t('Agent 要停止 VS 调试（结束 UE 进程）'))
      // 要 VS 才能做的动作：VS 没开先打开，等调试控制就绪
      const opened = ['start', 'attach', 'build'].includes(op) ? (await openVs(ctx.project)).opened : false
      const result = await vsCall(ctx.project, op, rest(a))
      return out(opened ? { openedVs: true, ...result } : result)
    },
  ),
  tool(
    'ue_vs_breakpoints',
    'VS 里的 C++ 断点（Lua 不行）。action=list 列断点（含用户自己下的，i 是编号；offset / limit 分页）；' +
      'add 下断点：file+line（相对路径按解决方案和 .uproject 目录找）或 function（AMyCharacter::Jump），可加 condition（Health < 0）、hitCount（第 N 次命中才停）、message（日志断点，不停下，把 Health={Health} 打到调试输出）；' +
      '数据断点给 data（this->Health 或地址表达式）+ size（1/2/4/8），只能在停下时设，值一变就停，x64 最多 4 个；同一位置已有断点时替换，没绑定时结果带 hint。' +
      'remove / enable 用 index、indexes、file+line 或 function 选（enable 带 enabled=false 是禁用）；clear 默认只删 Agent 下的（scope=all 连用户的一起删）。',
    {
      action: { type: 'string', enum: BP_OPS.map((o) => o.slice(3)) },
      file: { type: 'string' },
      line: { type: 'number' },
      function: { type: 'string' },
      condition: { type: 'string' },
      hitCount: { type: 'number' },
      message: { type: 'string' },
      data: { type: 'string' },
      size: { type: 'number' },
      ...FRAME_PROPS,
      index: { type: 'number' },
      indexes: { type: 'array', items: { type: 'number' } },
      enabled: { type: 'boolean' },
      scope: { type: 'string', enum: ['agent', 'all'] },
      offset: { type: 'number' },
      limit: { type: 'number' },
    },
    ['action'],
    async (a, ctx) => {
      const op = `bp.${String(a.action ?? '')}`
      if (!(BP_OPS as readonly string[]).includes(op))
        throw new VsDebugError(t('不认识的 action：{a}', { a: String(a.action) }))
      return out(await vsCall(ctx.project, op, rest(a)))
    },
  ),
  tool(
    'ue_vs_inspect',
    'UE 停在 VS 里（断点、单步、崩溃、check / ensure）时看现场。action=stack 调用栈（thread、offset、limit）；threads 线程列表（filter 按名字或位置筛）；' +
      'locals 一帧的参数和局部变量（frame、thread、depth 0–3、filter）；eval 按监视窗口求值 expr 或 exprs（最多 10 个，natvis 生效：FString、TArray、UObject*）——' +
      '表达式里能调用函数，有副作用（GetName() 没事，Destroy() 真会销毁）；output 调试输出窗口（UE_LOG 和日志断点在这里；带上次的 cursor 只取新增，filter 筛行）；' +
      'dump 存小转储到解决方案的 .vs/UEToVS/Debug/Dumps/ 留证据（full=true 带堆，几 GB）。stack / locals / eval 要停下才有。',
    {
      action: { type: 'string', enum: [...INSPECT_OPS] },
      ...FRAME_PROPS,
      offset: { type: 'number' },
      limit: { type: 'number' },
      filter: { type: 'string' },
      depth: { type: 'number' },
      expr: { type: 'string' },
      exprs: { type: 'array', items: { type: 'string' } },
      timeoutMs: { type: 'number' },
      cursor: { type: ['string', 'number'], description: 'output：上次结果里的 next' },
      maxChars: { type: 'number' },
      full: { type: 'boolean' },
    },
    ['action'],
    async (a, ctx) => {
      const op = String(a.action ?? '')
      if (!(INSPECT_OPS as readonly string[]).includes(op)) throw new VsDebugError(t('不认识的 action：{a}', { a: op }))
      return out(await vsCall(ctx.project, op, rest(a)))
    },
  ),
]
