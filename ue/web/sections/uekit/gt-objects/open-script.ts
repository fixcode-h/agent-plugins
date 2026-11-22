import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { GtScript } from '../../../../shared/gt-script/types.ts'

/**
 * 正在编辑的脚本（给二级栏「对象」页签用：列出「只在这个脚本里」的对象，存进对象库后在脚本里记上来源）。
 * 编辑器和对象页签不在一棵组件树的同一支上，用一个模块级的小仓库传，编辑器卸载时清掉
 */
export interface OpenScript {
  path: string
  doc: GtScript
  apply: (doc: GtScript) => void
  readOnly?: boolean
}

let cur: OpenScript | undefined
const subs = new Set<() => void>()

export function publishOpenScript(s: OpenScript | undefined) {
  cur = s
  subs.forEach((f) => f())
}

export const useOpenScript = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => void subs.delete(f)
    },
    () => cur,
  )

/** 编辑器里调：脚本变了就发布，卸载时清掉。apply 走 ref，免得每次渲染都通知一遍 */
export function usePublishOpenScript(path: string, doc: GtScript | undefined, apply: (d: GtScript) => unknown, readOnly: boolean) {
  const ref = useRef(apply)
  ref.current = apply
  useEffect(() => {
    publishOpenScript(doc ? { path, doc, apply: (d) => void ref.current(d), readOnly } : undefined)
  }, [path, doc, readOnly])
  useEffect(() => () => publishOpenScript(undefined), [])
}
