/**
 * 迁移（协议 game-test-ref 第 9 节）的上下文：一次迁移一份文件，按步骤收集「迁不准」的说明（写进步骤的 todo，
 * 校验报 warning migrate_todo，运行时照跑，引用 many: "first"），以及 v3 的 @句柄 落在哪个部件上（find 抓的是控件）。
 */
export interface MigrateTodo {
  /** 写进了哪里（steps.3、guards.0、objects.shop） */
  at: string
  message: string
}

export interface MigrateCtx {
  /** 当前这一步的录制线索（hint.key、hint.asset…），选择器挑不出标识时用 */
  hint?: Record<string, unknown>
  /** v3 find 抓到的句柄名 → 它在对象里的部件（v4 里句柄是对象，部件另记） */
  handles: Map<string, string | undefined>
  /**
   * vars 里初值是选择器字符串的变量（v3 允许 target: "$crumb"、text($status)）：v4 的 $var 只能是对象，
   * 迁移时把用到它的地方换成它的选择器迁出来的部件写法，变量本身没人用了就去掉
   */
  selVars: Map<string, string>
  /** params 里默认值是选择器的参数（call with 传选择器进来）：迁不了，写 todo */
  selParams: Set<string>
  /** 当前这一步攒下的待定说明 */
  pending: string[]
  todos: MigrateTodo[]
}

export const newCtx = (): MigrateCtx => ({
  handles: new Map(),
  selVars: new Map(),
  selParams: new Set(),
  pending: [],
  todos: [],
})

export const todo = (ctx: MigrateCtx, message: string) => {
  if (!ctx.pending.includes(message)) ctx.pending.push(message)
}

/** 把攒下的待定说明写到 holder（步骤、守护、引用）的 todo 上，已有的接在后面 */
export function flushTodo(ctx: MigrateCtx, holder: Record<string, unknown>, at: string) {
  if (!ctx.pending.length) return
  const text = ctx.pending.join('；')
  holder.todo = typeof holder.todo === 'string' && holder.todo ? `${holder.todo}；${text}` : text
  for (const m of ctx.pending) ctx.todos.push({ at, message: m })
  ctx.pending = []
}
