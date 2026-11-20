import { useCallback, useEffect, useRef, useState } from 'react'
import type { Target } from '../server/types.ts'
import { h } from './host.ts'
import { keep, kept } from './keep.ts'

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

/**
 * 取数据的小钩子：deps 变了重取；interval 给了就定时刷新（页面藏起来时不刷）。
 * 给了 keepKey 时结果记进 keep.ts 的表：切页面再回来、deps 没变就先显示上次的结果，同时照常重取一次换成最新的
 * （用户 2026-11-15：切回来要看到最新的，对象没了要清掉）
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], interval = 0, keepKey?: string) {
  const sig = keepKey ? JSON.stringify(deps) : ''
  const [data, setDataRaw] = useState<T | undefined>(() => {
    const k = keepKey ? kept<{ sig: string; data: T }>(keepKey) : undefined
    return k && k.sig === sig ? k.data : undefined
  })
  const keySig = useRef(sig)
  keySig.current = sig
  const setData = useCallback(
    (d: T | undefined) => {
      setDataRaw(d)
      if (keepKey) keep(keepKey, d === undefined ? undefined : { sig: keySig.current, data: d })
    },
    [keepKey],
  )
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)
  const inFlight = useRef(false)
  const fn = useRef(load)
  fn.current = load
  // 返回这次读到的数据（被更新的一次顶掉、出错时返回 undefined）：调用方要拿最新值接着做事时不用自己另发请求，
  // 自己另发的请求不进 seq，挡不住还在路上的旧请求回来覆盖（选中「跟随」，PR #208 评审指出）
  const reload = useCallback(async (): Promise<T | undefined> => {
    const my = ++seq.current
    setLoading(true)
    try {
      const d = await fn.current()
      if (my === seq.current) {
        setData(d)
        setError('')
        return d
      }
    } catch (e) {
      if (my === seq.current) setError((e as Error).message)
    } finally {
      if (my === seq.current) setLoading(false)
    }
    return undefined
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
