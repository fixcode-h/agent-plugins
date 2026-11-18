import { walk, type GtScript } from '../../../../shared/gt-script/index.ts'
import { stepKey } from '../gt-flow/layout.ts'

/**
 * 编辑页当前的调试会话：命令表（F9、运行到这里、展开调用……）、画布节点都从这里取，不经 CmdCtx 层层传。
 * 同一时间只开一个编辑页，GtEditor 打开时设上、关掉时清掉
 */
export interface DebugRunOpts {
  /** 从哪一步开始（步骤 key） */
  from?: string
  /** 跑到哪一步停下暂停 */
  to?: string
}

export interface DebugSession {
  project: string
  /** 场景根（相对或绝对，和编辑页的 root 一样） */
  root: string
  /** 能开跑（连着编辑器、没在录制）时才有 */
  run?: (o: DebugRunOpts) => void
  running: boolean
  paused: boolean
}

let active: DebugSession | undefined

export const debugSession = () => active
export const setDebugSession = (s: DebugSession | undefined) => {
  active = s
}

/** 脚本里现有的全部步骤 key：删掉的步骤上留着的断点不发给 UE */
export function stepKeys(doc: GtScript): Set<string> {
  const keys = new Set<string>()
  walk(doc, (e) => void keys.add(stepKey(e.step, e.path)))
  return keys
}
