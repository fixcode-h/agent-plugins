import { useState } from 'react'
import { op } from '../../../api.ts'
import { h } from '../../../host.ts'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { useLiveWatch } from './use-watch.ts'

/** gt.resolve conds 的一项（协议第 10 节）：此刻成不成立，每条判断的实际值 */
export interface CondResolved {
  id?: string
  holds?: boolean
  parts?: { path: string; holds: boolean; actual?: unknown; unresolved?: string }[]
}

/** gt.resolve exprs 的一项 */
export interface ExprResolved {
  id?: string
  value?: unknown
  type?: string
  unresolved?: string
  error?: string
}

export interface NowState<T> {
  /** 按 id 的此刻结果 */
  byId: Map<string, T>
  /** live：连着游戏一直刷新；manual：GameTest 太旧，要点「现在核对」问一次；off：没连着游戏 */
  mode: 'live' | 'manual' | 'off'
  checking: boolean
  check: () => void
  error: string
}

/**
 * 条件组、按状态分支的「此刻成不成立」（定稿 9.2）：连着游戏时用 gt.watch 一直刷新；
 * 编辑器里的 GameTest 还没有 gt.watch（1.10.0 以前）就退回手点「现在核对」问一次 gt.resolve
 */
export function useCondNow(conds: { id: string; cond: unknown }[] | undefined): NowState<CondResolved> {
  return useNow(
    'conds',
    conds?.map((c) => ({ id: c.id, cond: c.cond })),
  )
}

/** 表达式此刻的值（定稿 3.3「下面实时显示此刻的结果」） */
export function useExprNow(exprs: { id: string; expr: string }[] | undefined): NowState<ExprResolved> {
  return useNow('exprs', exprs)
}

function useNow<T extends { id?: string }>(field: 'conds' | 'exprs', list: unknown[] | undefined): NowState<T> {
  const ctx = useEditCtx()
  const want = ctx.live && !!list?.length
  const watch = useLiveWatch(ctx.project, want ? { r: { op: 'gt.resolve', args: { [field]: list } } } : undefined)
  const [manual, setManual] = useState<{ key: string; items: T[] }>()
  const [checking, setChecking] = useState(false)
  const key = JSON.stringify(list ?? null)

  const live = (watch.results.r?.[field] as T[] | undefined) ?? []
  const items = watch.unsupported ? (manual?.key === key ? manual.items : []) : live
  const byId = new Map(items.map((x) => [String(x.id ?? ''), x]))

  const check = () => {
    if (!list?.length) return
    setChecking(true)
    op<Record<string, T[] | undefined>>(ctx.project, 'gt.resolve', { [field]: list })
      .then((r) => setManual({ key, items: r[field] ?? [] }))
      .catch((e: Error) => h().toast.error(e.message))
      .finally(() => setChecking(false))
  }

  return {
    byId,
    mode: !want ? 'off' : watch.unsupported ? 'manual' : 'live',
    checking,
    check,
    // 查询本身出错（游戏世界没了）放在结果的 error 里，照常显示
    error: watch.unsupported ? '' : watch.error || String(watch.results.r?.error ?? ''),
  }
}
