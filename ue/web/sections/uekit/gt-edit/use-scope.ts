import { useEffect, useState } from 'react'
import {
  getAt,
  isSubgraph,
  pathStr,
  slotsOf,
  type GtPath,
  type GtScript,
  type GtStep,
} from '../../../../shared/gt-script/index.ts'
import { blockUi } from '../gt-blocks/index.ts'
import { findScope, scopeKey, scopeOfSlot } from '../gt-flow/bp/graph.ts'
import type { Crumb } from './EditorHeader.tsx'

const isStep = (v: unknown): v is GtStep => !!v && typeof v === 'object' && typeof (v as GtStep).action === 'string'
const labelOf = (s: GtStep) => (typeof s.name === 'string' && s.name.trim() ? s.name : blockUi(s.action).title())

/**
 * 流程图「进到子图里面」（用户 2026-11-19：段是子图，双击进去只看里面，顶上路径显示在第几层、点了回去；
 * 如果、循环不算子图，在画布上摊开连线）。
 * 记的是块的 key（步骤 id），改动让路径变了也找得回来；块没了就回到最外层。
 * 在别处（列表、运行面板）选中了某个块里面的步骤时跟过去，画布上看得到选中的那步
 */
export function useScope(doc: GtScript | undefined, selected: GtPath[], select: (p: GtPath[]) => void) {
  const [key, setKey] = useState<string>()
  const path = doc && key ? findScope(doc, key) : undefined
  const crumbs: Crumb[] = []
  if (doc && path)
    for (let i = 1; i <= path.length; i++) {
      const p = path.slice(0, i)
      const v = getAt(doc, p)
      if (typeof p[p.length - 1] !== 'number' || !isStep(v) || !isSubgraph(v) || !slotsOf(v).length) continue
      const k = scopeKey(v, p)
      crumbs.push({ label: labelOf(v), onClick: () => setKey(k) })
    }
  const first = selected[0]
  const sel = first ? pathStr(first) : ''
  useEffect(() => {
    if (!doc || !first) return
    const at = scopeOfSlot(doc, first.slice(0, -1))
    if (at !== (path && doc ? scopeKey(getAt(doc, path) as GtStep, path) : '')) setKey(at || undefined)
    // 只在选中换了时跟：进去以后改脚本不该把画布拉回别的层
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])
  return {
    path,
    crumbs,
    enter: (p: GtPath, step: GtStep) => {
      select([])
      setKey(scopeKey(step, p))
    },
    /** 回到上一层 */
    leave: () => {
      if (!doc || !path) return
      const up = scopeOfSlot(doc, path.slice(0, -1))
      select([path])
      setKey(up || undefined)
    },
    root: () => setKey(undefined),
  }
}
