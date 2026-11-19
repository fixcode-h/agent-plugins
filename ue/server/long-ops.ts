import { BridgeError, info, rpc, type Card } from './instances.ts'

/**
 * 长操作变作业（UELink 2.13 的 job.start / job.wait，UEKit docs/protocol.md「作业」）：编译蓝图、改名、删除、批量校验
 * 交给 UE 当作业跑，马上拿到作业号；面板用 job.wait 等一会儿（UE 做完就回，不轮询），做完就和直接调一样返回结果，
 * 没做完把作业号交给 Agent，它带 job 再调一次接着等。旧桥接没有 job.start 时照旧直接调。
 */

/** 一次最多替 Agent 等多久：再长对话里就像卡住了 */
export const WAIT_MS = 20000

/** 进程（pid）支不支持作业：/info 的 ops 里有没有 job.start，问一次记住 */
const support = new Map<number, boolean>()

async function canJob(card: Card) {
  const known = support.get(card.pid)
  if (known !== undefined) return known
  const inst = await info(card)
  const yes = !!inst.ops?.includes('job.start')
  if (inst.online) support.set(card.pid, yes)
  return yes
}

/** 进程（pid）能批量的操作（UELink 2.14 /info 的 batchOps），问一次记住 */
const batchSupport = new Map<number, Set<string>>()

/** 参数里给了 paths / items：交给 UELink 的批量（一个操作作用到多个资源，展开成一个作业） */
export const isBatchArgs = (args: Record<string, unknown>) => Array.isArray(args.paths) || Array.isArray(args.items)

async function canBatch(card: Card, op: string) {
  let ops = batchSupport.get(card.pid)
  if (!ops) {
    const inst = await info(card)
    ops = new Set(inst.batchOps ?? [])
    if (inst.online) batchSupport.set(card.pid, ops)
  }
  return ops.has(op)
}

export type JobOutcome = { done: true; res: Record<string, unknown> } | { done: false; res: Record<string, unknown> }

/** 作业的结果：一步的拆出 result（和直接调这个操作的回包一样），失败、取消按报错抛；多步的整个给出 */
function unwrap(r: Record<string, unknown>): Record<string, unknown> {
  // 批量作业：按资源的汇总（batch）整个给出，失败的资源在汇总里，不按报错抛
  if (r.batch) return r
  const steps = Number(r.total ?? 1)
  if (r.status === 'cancelled' && steps === 1) throw new BridgeError(`作业 ${r.id} 已取消`)
  if (steps !== 1) return r
  if (r.status === 'failed') throw new BridgeError(String(r.error ?? '执行失败'))
  return (r.result as Record<string, unknown> | undefined) ?? {}
}

function running(id: string, r: Record<string, unknown>) {
  return {
    job: id,
    status: r.status ?? 'running',
    finished: r.finished,
    total: r.total,
    ...(r.current ? { current: r.current } : {}),
    note: `还没做完（UE 在后台接着做）：带 job=${id} 再调一次同一个工具接着等结果，不要重复发起`,
  }
}

/** 等作业做完或等满 ms；UE 的游戏线程被这一步占着时回复会晚到，等不到也只当还在跑 */
export async function waitJob(card: Card, id: string, ms = WAIT_MS): Promise<JobOutcome> {
  let r: Record<string, unknown>
  const limit = ms + 60000
  const t0 = Date.now()
  try {
    r = await rpc(card, 'job.wait', { id, timeoutMs: ms }, limit)
  } catch (e) {
    // 超时（一步本身就跑了很久，回复排在它后面）：作业还在 UE 里跑，不当失败
    if (Date.now() - t0 >= limit - 1000) return { done: false, res: running(id, { status: 'running' }) }
    throw e
  }
  if (r.status === 'running' || r.status === 'queued') return { done: false, res: running(id, r) }
  return { done: true, res: unwrap(r) }
}

/** 按作业跑一个操作；旧桥接直接调 */
export async function runAsJob(
  card: Card,
  op: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<JobOutcome> {
  // 批量：操作本身收到 paths / items 就回作业号（UELink 2.14），不再套一层 job.start
  if (isBatchArgs(args)) {
    if (!(await canBatch(card, op)))
      throw new BridgeError(
        `这个 UE 进程的 UELink 不支持批量 ${op}（要 UELink 2.14 起，在 UE 页「UE 插件」升级后完整编译）：先逐个调`,
      )
    const started = await rpc(card, op, args, 60000)
    return waitJob(card, String(started.job))
  }
  if (!(await canJob(card))) return { done: true, res: await rpc(card, op, args, timeoutMs) }
  const started = await rpc(card, 'job.start', { op, args }, 30000)
  return waitJob(card, String(started.job))
}

/**
 * 没等到结果的作业：记下在哪个进程、做完后怎么收尾（操作记录、撤回信息、P4），Agent 带 job 再调时接着等。
 * 键是项目 id + 作业号；面板重启就丢了，这时 UE 那边的结果文件还在
 */
export interface PendingJob {
  card: Card
  finish: (res: Record<string, unknown>) => Promise<Record<string, unknown>>
  fail: (e: Error) => Promise<void>
}

const pending = new Map<string, PendingJob>()

export function keepJob(project: string, id: string, p: PendingJob) {
  pending.set(`${project}|${id}`, p)
  if (pending.size > 50) pending.delete(pending.keys().next().value as string)
}

/** Agent 带 job 再调：接着等，做完按原操作收尾 */
export async function resumeJob(project: string, id: string): Promise<Record<string, unknown>> {
  const key = `${project}|${id}`
  const p = pending.get(key)
  if (!p)
    throw new BridgeError(
      `没有在等的作业 ${id}（已经取过结果，或面板重启过）：结果文件在 UE 项目的 Saved/UELink/jobs/${id}.json`,
    )
  try {
    const r = await waitJob(p.card, id)
    if (!r.done) return { ...r.res, instance: { pid: p.card.pid, kind: p.card.kind } }
    pending.delete(key)
    return await p.finish(r.res)
  } catch (e) {
    pending.delete(key)
    await p.fail(e as Error)
    throw e
  }
}
