import { useEffect, useMemo, useRef, useState } from 'react'
import type { GtScript } from '../../../../shared/gt-script/index.ts'
import { op } from '../../../api.ts'
import { h } from '../../../host.ts'
import { useExtEvents } from '../ListCol.tsx'
import type { GtFlowEvent } from '../gt-flow/run-state.ts'
import { useFlowRun } from '../gt-flow/use-flow-run.ts'
import { setBreakpointScope, useBreakpoints } from './breakpoints.ts'
import { applyLog, emptyLog, type RunLog } from './run-log.ts'
import { setDebugSession, stepKeys, type DebugRunOpts } from './session.ts'

/** 真正开跑：外壳给（走 GameTest 页的作业状态），args 并进 gt.run（params、from、to、breakpoints） */
export type StartRun = (args: Record<string, unknown>) => void

interface DebugState {
  state?: 'running' | 'paused' | 'idle'
  vars?: Record<string, unknown>
}

/**
 * 编辑页的调试（定稿 9.2「运行控制」、效果图 6，协议第 10 节的 gt.run 调试参数和 gt.debug）：
 * - 开跑时带上断点、从哪到哪、参数；脚本有参数时先弹窗填（pending）；
 * - 跑着时断点改了马上发给 UE（gt.debug breakpoints），暂停 / 继续 / 单步也走 gt.debug；
 * - 运行记录、此刻的变量都只从推送（gt.flow）来，暂停时推送没带变量才问一次 gt.debug state，不轮询
 */
export function useDebug(o: { project: string; root: string; scenario: string; doc?: GtScript; start?: StartRun }) {
  const { project, doc } = o
  const flow = useFlowRun(project, o.scenario)
  const [log, setLog] = useState<RunLog>(emptyLog)
  const [askVars, setAskVars] = useState<Record<string, unknown>>()
  const [pending, setPending] = useState<DebugRunOpts>()
  const bps = useBreakpoints()
  const keys = useMemo(() => (doc ? stepKeys(doc) : new Set<string>()), [doc])
  const live = useMemo(() => [...bps].filter((k) => keys.has(k)), [bps, keys])

  useEffect(() => setBreakpointScope(project, o.scenario), [project, o.scenario])
  useEffect(() => setLog(emptyLog()), [o.scenario])
  useExtEvents(project, (e) => {
    if (e.event === 'gt.flow') setLog((l) => applyLog(l, e as unknown as GtFlowEvent, Date.now()))
  })

  const debug = async (action: string, extra: Record<string, unknown> = {}) => {
    try {
      const r = await op<DebugState>(project, 'gt.debug', { action, ...extra })
      if (r.vars) setAskVars(r.vars)
      return r
    } catch (e) {
      h().toast.error((e as Error).message)
    }
  }

  // 跑着时改了断点：马上换掉 UE 那边的（下一个节点开始前生效）
  const sent = useRef('')
  useEffect(() => {
    if (!flow.active) {
      sent.current = ''
      return
    }
    const sig = live.join('\n')
    if (sig === sent.current) return
    sent.current = sig
    void debug('breakpoints', { ids: live })
    // debug 每次渲染都是新函数，只在断点、运行状态变了时发
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.active, live])

  // 停下了但推送里没带变量（旧推送、丢了一条）：问一次此刻的变量
  useEffect(() => {
    if (flow.paused && !flow.vars) void debug('state')
    if (!flow.paused) setAskVars(undefined)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.paused, flow.at])

  const go = (r: DebugRunOpts, params?: Record<string, unknown>) => {
    if (!o.start) return
    o.start({
      ...(live.length ? { breakpoints: live } : {}),
      ...(r.from ? { from: r.from } : {}),
      ...(r.to ? { to: r.to } : {}),
      ...(params && Object.keys(params).length ? { params } : {}),
    })
  }
  const hasParams = !!doc?.params && Object.keys(doc.params).length > 0
  /** 开跑：脚本有参数时先弹窗填 */
  const run = o.start
    ? (r: DebugRunOpts = {}) => {
        if (hasParams) setPending(r)
        else go(r)
      }
    : undefined

  const session = { project, root: o.root, run, running: flow.active, paused: flow.paused }
  setDebugSession(session)
  useEffect(() => () => setDebugSession(undefined), [])

  return {
    flow,
    log,
    vars: flow.vars ?? askVars,
    breakpoints: live,
    run,
    /** 填参数的弹窗：开跑前等着填 */
    pending,
    confirmParams: (params: Record<string, unknown>) => {
      const r = pending
      setPending(undefined)
      if (r) go(r, params)
    },
    cancelParams: () => setPending(undefined),
    pause: () => void debug('pause'),
    resume: () => void debug('resume'),
    step: (into = false) => void debug('step', into ? { into: true } : {}),
  }
}

export type DebugApi = ReturnType<typeof useDebug>
