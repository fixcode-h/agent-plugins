import type { DiffProgress, DiffStep, StepId } from '../../shared/asset-diff/progress.ts'
import { BridgeError } from '../instances.ts'
import { c, t } from '../util.ts'

/**
 * 版本差异的分步进度（设计稿「UE资源版本差异-修复与强化」3.1）：每一步变了就推给发起的那个页面（不轮询），
 * 网页能看出卡在取文件还是 UE 加载、由谁在读；「取消」让这一次不再等（UE 里正在加载的那一下打断不了，结果回来丢掉）。
 */
export const DIFF_EVENT = 'ue-asset-diff'

const running = new Map<string, () => void>() // 模块状态：正在算的请求 → 取消

export class DiffTracker {
  private readonly p: DiffProgress
  private cancelled = false
  private wake: (() => void) | undefined

  constructor(
    req: string,
    private readonly conn: string | undefined,
    steps: { id: StepId; label: string }[],
  ) {
    this.p = { req, startedAt: Date.now(), steps: steps.map((s) => ({ ...s, state: 'wait' })) }
    if (req)
      running.set(req, () => {
        this.cancelled = true
        this.wake?.()
      })
    this.push()
  }

  private push() {
    if (this.conn && this.p.req) c().pages?.push(DIFF_EVENT, this.p, this.conn)
  }

  private at(id: StepId): DiffStep | undefined {
    return this.p.steps.find((s) => s.id === id)
  }

  set(id: StepId, patch: Partial<DiffStep>) {
    const s = this.at(id)
    if (!s) return
    if (patch.state === 'run') s.since = Date.now()
    if ((patch.state === 'ok' || patch.state === 'fail') && s.since) s.ms = Date.now() - s.since
    Object.assign(s, patch)
    this.push()
  }

  reader(kind: string, pid: number) {
    this.p.reader = { kind, pid }
    this.push()
  }

  /** 包一步：开始标 run，结束标 ok（或调用方自己标 skip），出错标 fail；取消时马上抛出，不等这一步 */
  async step<T>(id: StepId, fn: () => Promise<T>, done?: (v: T) => Partial<DiffStep>): Promise<T> {
    this.check()
    this.set(id, { state: 'run' })
    const cancel = new Promise<never>((_, reject) => {
      this.wake = () => reject(new BridgeError(t('已取消')))
    })
    try {
      const v = await Promise.race([fn(), cancel])
      if (this.at(id)?.state === 'run') this.set(id, { state: 'ok', ...done?.(v) })
      return v
    } catch (e) {
      this.set(id, { state: 'fail', detail: (e as Error).message })
      throw e
    } finally {
      this.wake = undefined
    }
  }

  check() {
    if (this.cancelled) throw new BridgeError(t('已取消'))
  }

  end() {
    running.delete(this.p.req)
  }
}

export function cancelDiff(req: string) {
  const f = running.get(req)
  f?.()
  return { cancelled: !!f }
}
