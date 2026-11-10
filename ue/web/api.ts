import { useCallback, useEffect, useRef, useState } from 'react'
import type { Target } from '../server/types.ts'
import { h } from './host.ts'

/** 插件接口：/api/plugins/ue/ 下（server/api.ts）。出错时服务端回 { error }，这里抛出来给界面原样显示 */
async function unwrap<T>(p: Promise<T>): Promise<T> {
  const r = (await p) as T & { error?: string }
  if (r && typeof r === 'object' && 'error' in r && r.error) throw new Error(r.error)
  return r
}

export const get = <T>(path: string) => unwrap(h().api.get<T>(path))
export const post = <T>(path: string, body?: unknown) => unwrap(h().api.post<T>(path, body ?? {}))

export const pget = <T>(project: string, path: string) => get<T>(`/p/${encodeURIComponent(project)}/${path}`)
export const ppost = <T>(project: string, path: string, body?: unknown) =>
  post<T>(`/p/${encodeURIComponent(project)}/${path}`, body)

/** 调桥接的一个操作（网页上记成「你」做的） */
export function op<T = Record<string, unknown>>(
  project: string,
  name: string,
  args: Record<string, unknown> = {},
  target?: Target,
  timeout?: number,
) {
  return ppost<T>(project, 'op', { op: name, args, target, timeout })
}

/** 取数据的小钩子：deps 变了重取；interval 给了就定时刷新（页面藏起来时不刷） */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], interval = 0) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)
  const inFlight = useRef(false)
  const fn = useRef(load)
  fn.current = load
  const reload = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    try {
      const d = await fn.current()
      if (my === seq.current) {
        setData(d)
        setError('')
      }
    } catch (e) {
      if (my === seq.current) setError((e as Error).message)
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    void reload()
    if (!interval) return
    // 定时刷新：页面藏起来时不刷；上一次还没回来（UE 卡在断点、长帧里）就跳过这一拍，不让请求越堆越多
    const id = setInterval(() => {
      if (document.hidden || inFlight.current) return
      inFlight.current = true
      void reload().finally(() => (inFlight.current = false))
    }, interval)
    return () => clearInterval(id)
    // deps 由调用方给：load 每次渲染都是新函数，放进依赖会无限重取
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, interval])
  return { data, error, loading, reload, setData }
}

/** 执行一个动作：busy 期间禁用按钮，出错 toast 原样显示 */
export function useAction() {
  const [busy, setBusy] = useState('')
  const runAction = useCallback(async <T>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(key)
    try {
      return await fn()
    } catch (e) {
      h().toast.error((e as Error).message)
      return undefined
    } finally {
      setBusy('')
    }
  }, [])
  return { busy, run: runAction }
}

/** 值显示成一行文字（属性面板、表格单元格） */
export function show(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const o = v as Record<string, unknown>
  if (o._truncated) return String(o._preview ?? '') + ' …'
  return JSON.stringify(v)
}
