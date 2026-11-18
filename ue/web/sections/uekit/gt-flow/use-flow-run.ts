import { useEffect, useState } from 'react'
import { useExtEvents } from '../ListCol.tsx'
import {
  applyFlowEvent,
  applyJob,
  emptyRun,
  type FlowRunState,
  type GtFlowEvent,
  type GtJobFlowPart,
} from './run-state.ts'

/**
 * 流程图的运行高亮：订阅这个项目的 gt.flow（节点进出、循环换轮、守护）和 gt.job（守护次数、跑没跑完），不轮询。
 * scenario 变了（换了个脚本看）就清掉；同一个脚本再跑一次时 runId 变了，run-state 自己会清
 */
export function useFlowRun(projectId: string, scenario?: string): FlowRunState {
  const [run, setRun] = useState<FlowRunState>(emptyRun)
  useEffect(() => setRun(emptyRun()), [scenario])
  useExtEvents(projectId, (e) => {
    if (e.event === 'gt.flow') setRun((s) => applyFlowEvent(s, e as unknown as GtFlowEvent))
    else if (e.event === 'gt.job') setRun((s) => applyJob(s, e as unknown as GtJobFlowPart))
  })
  return run
}
