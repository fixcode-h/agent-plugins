import { useCallback, useRef, useState } from 'react'
import type { GtPath, GtScript, GtStep } from '../../../../shared/gt-script/index.ts'
import { op } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { useExtEvents } from '../ListCol.tsx'
import { loadReport } from '../gt-run/types.ts'
import { stepTryArgs, stepTryFromReport, stepTryOf, type StepTry } from './step-try.ts'

/**
 * 编辑页「只做这一步」（分析文档 B1、B2）：带上脚本的 objects 和参数默认值跑 gt.step，
 * 结果留给右栏「运行 → 这一步」页看（以前只弹一句提示，返回值、命中、证据都看不到）。
 * 要等几帧的步骤 GameTest 包成临时运行：等 gt.job 推送 finished 再读报告补上，不轮询
 */
export function useStepTry(project: string, doc: GtScript | undefined, disk: boolean) {
  const [res, setRes] = useState<StepTry>()
  const [busy, setBusy] = useState(false)
  const n = useRef(0)
  const cur = useRef<StepTry>(undefined)
  cur.current = res

  useExtEvents(project, (e) => {
    const r = cur.current
    if (e.event !== 'gt.job' || !r?.pending || (e as { runId?: string }).runId !== r.runId) return
    if ((e as { phase?: string }).phase !== 'finished') return
    loadReport(project, r.runId!, disk)
      .then((steps) => setRes((now) => (now?.n === r.n ? stepTryFromReport(now, steps) : now)))
      .catch((err: Error) =>
        setRes((now) => (now?.n === r.n ? { ...now, pending: undefined, ok: false, message: err.message } : now)),
      )
  })

  const run = useCallback(
    async (path: GtPath, step: GtStep) => {
      const id = ++n.current
      const t0 = Date.now()
      setBusy(true)
      try {
        const r = await op<Record<string, unknown>>(project, 'gt.step', stepTryArgs(doc, step), undefined, 120000)
        setRes(stepTryOf(path, r, t0, id))
      } catch (err) {
        // 没能开始（没连上、有运行在跑……）：照样显示在「这一步」页，出错原样给用户看
        setRes({
          n: id,
          path,
          at: new Date().toISOString(),
          ms: Date.now() - t0,
          ok: false,
          message: (err as Error).message,
        })
        h().toast.error((err as Error).message || t('这一步没能开始'))
      } finally {
        setBusy(false)
      }
    },
    [project, doc],
  )
  return { res, busy, run }
}
