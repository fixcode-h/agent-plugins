import { useEffect, useMemo, useState } from 'react'
import { op } from '../../../api.ts'
import { h } from '../../../host.ts'
import { useExtEvents } from '../ListCol.tsx'

/** gt.watch 的一项（GameTest 1.10.0，脚本协议第 10 节）：只能挂只读查询 */
export interface WatchItem {
  op: 'gt.resolve' | 'gt.vars' | 'gt.inspect'
  args: Record<string, unknown>
}
export type WatchItems = Record<string, WatchItem>

/** UE 那边 60 秒没续就停：页面关了、换了脚本不会一直在算 */
const TTL_MS = 60000
/** 续租间隔。续租只是告诉 UE「还有人在看」，结果仍然只靠 gt.watch 推送（面板规则：实时数据用推送） */
const RENEW_MS = 20000
/** 条件、表达式边打字边变：停手一会儿再登记，不按每个键都问一次 */
const DEBOUNCE_MS = 250

/** 多久重算一次：UE 插件设置「GameTest 编写」里的「此刻结果多久刷新」，默认 0.2 秒（定稿 9.3） */
export function watchIntervalMs() {
  const v = h().config().gtWatchMs
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(2000, Math.max(100, Math.round(v))) : 200
}

/** 旧版 GameTest（1.10.0 以前）没有 gt.watch / gt.pick：调用方退回「现在核对」问一次 */
export const isUnsupported = (message: string, name: string) => message.includes(`不支持 ${name}`)

export interface LiveWatch {
  /** 每个键最新的结果：操作的返回，或 {error} */
  results: Record<string, Record<string, unknown> | undefined>
  /** 登记成功、拿到过一份完整结果 */
  ready: boolean
  /** 编辑器里的 GameTest 太旧 */
  unsupported: boolean
  error: string
  /** 每个键最近一次变化的时间（Date.now）：字段变了闪一下用 */
  changedAt: Record<string, number>
}

const EMPTY: LiveWatch = { results: {}, ready: false, unsupported: false, error: '', changedAt: {} }

/**
 * 连着游戏时「此刻的结果」：向 GameTest 登记一组只读查询（gt.watch），之后只收 gt.watch 推送，变了的键才会来。
 * items 为空（没连着游戏、没东西可看）时不登记；卸载、items 变了先停掉旧的。条件组、表达式、抓控件的状态和字段都走这里
 */
export function useLiveWatch(project: string, items: WatchItems | undefined): LiveWatch {
  const id = useMemo(() => `w${Math.random().toString(36).slice(2, 10)}`, [])
  const [state, setState] = useState<LiveWatch>(EMPTY)
  const key = items && Object.keys(items).length ? JSON.stringify(items) : ''

  useEffect(() => {
    setState(EMPTY)
    if (!key) return
    let off = false
    const args = { id, items: JSON.parse(key) as WatchItems, intervalMs: watchIntervalMs(), ttlMs: TTL_MS }
    const arm = () =>
      op<{ results?: LiveWatch['results'] }>(project, 'gt.watch', args)
        .then((r) => {
          if (off) return
          const now = Date.now()
          setState((s) => {
            const results = r.results ?? {}
            const changedAt = { ...s.changedAt }
            for (const k of Object.keys(results))
              if (s.ready && JSON.stringify(s.results[k]) !== JSON.stringify(results[k])) changedAt[k] = now
            return { results, ready: true, unsupported: false, error: '', changedAt }
          })
        })
        .catch((e: Error) => {
          if (off) return
          setState((s) => ({ ...s, ready: false, unsupported: isUnsupported(e.message, 'gt.watch'), error: e.message }))
        })
    const start = setTimeout(() => void arm(), DEBOUNCE_MS)
    const renew = setInterval(() => void arm(), RENEW_MS)
    return () => {
      off = true
      clearTimeout(start)
      clearInterval(renew)
      void op(project, 'gt.watch', { id, stop: true }).catch(() => undefined)
    }
  }, [project, key, id])

  useExtEvents(project, (e) => {
    if (e.event !== 'gt.watch' || e.id !== id) return
    const results = e.results as LiveWatch['results'] | undefined
    if (!results) return
    const now = Date.now()
    setState((s) => {
      const changedAt = { ...s.changedAt }
      for (const k of Object.keys(results)) changedAt[k] = now
      return { ...s, results: { ...s.results, ...results }, changedAt }
    })
  })

  return state
}
