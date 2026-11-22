import { useCallback, useEffect, useRef, useState } from 'react'
import {
  parseScript,
  serialize,
  tidyScript,
  type EditResult,
  type GtPath,
  type GtScript,
} from '../../../../shared/gt-script/index.ts'
import { absorbLibDrops } from '../../../../shared/obj-lib/link.ts'
import { ppost } from '../../../api.ts'
import { h, t } from '../../../host.ts'

/**
 * 编辑页的场景状态：读原文、改（每次改动是一个新对象，撤销就是退回旧对象）、选中、存盘。
 * 列表、流程图、JSON 三种视图都通过它改同一份数据（定稿 9.1「一份数据，三种看法」）。
 * 存盘整份写回（ext/gt/file save），带打开时读到的原文核对，别人在这期间改过就拒绝，不覆盖
 */
export interface ScriptState {
  doc?: GtScript
  /** 读出来的原文：存盘时核对 */
  base: string
  /** 改过、还没存 */
  dirty: boolean
  error: string
  loading: boolean
  saving: boolean
  /** 选中的步骤（主选中在第一个） */
  selected: GtPath[]
  canUndo: boolean
  canRedo: boolean
}

export interface ScriptApi extends ScriptState {
  /** 应用一次结构操作：返回 undefined 的（做不了）提示一句，不改 */
  apply: (r: EditResult | GtScript | undefined, what?: string) => boolean
  select: (paths: GtPath[]) => void
  undo: () => void
  redo: () => void
  save: () => Promise<void>
  reload: () => Promise<void>
}

const HISTORY = 100

export function useScript(o: { project: string; root: string; path: string }): ScriptApi {
  const [doc, setDoc] = useState<GtScript>()
  const [base, setBase] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<GtPath[]>([])
  const past = useRef<GtScript[]>([])
  const future = useRef<GtScript[]>([])
  // 撤销栈在 ref 里，按钮的可用状态靠这个数字刷新
  const [, bump] = useState(0)
  const saved = useRef<GtScript | undefined>(undefined)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const r = await ppost<{ text: string }>(o.project, 'ext/gt/file', { root: o.root, path: o.path, action: 'raw' })
      const p = parseScript(r.text)
      if ('error' in p) throw new Error(t('场景不是合法的 JSON：{e}', { e: p.error }))
      // 打开时就整理（补 kind、补 id）：没改动时不算「改过」，存盘才写回。旧版本不迁移，编辑页只读（gt-ref/gate.tsx）
      const tidy = tidyScript(p.doc)
      setBase(r.text.replace(/^﻿/, ''))
      setDoc(tidy)
      // 只是格式不同（UE 写的缩进、补 id）不算改过：用户没动就不提示「没存」，下次存盘时一起整理
      saved.current = tidy
      past.current = []
      future.current = []
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [o.project, o.root, o.path])

  useEffect(() => {
    void reload()
  }, [reload])

  const apply = useCallback(
    (r: EditResult | GtScript | undefined, what?: string) => {
      if (!r || !doc) {
        if (what) h().toast.error(what)
        return false
      }
      const next = 'doc' in r && 'path' in r && Array.isArray(r.path) ? (r as EditResult) : undefined
      past.current = [...past.current.slice(-HISTORY + 1), doc]
      future.current = []
      // 从「对象」页签拖进来的步骤带着对象库的一项：拷进脚本 objects、记下来源（shared/obj-lib/link.ts）
      setDoc(absorbLibDrops(next ? next.doc : (r as GtScript)))
      if (next) setSelected([next.path])
      bump((n) => n + 1)
      return true
    },
    [doc],
  )

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev || !doc) return
    future.current.push(doc)
    setDoc(prev)
    bump((n) => n + 1)
  }, [doc])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next || !doc) return
    past.current.push(doc)
    setDoc(next)
    bump((n) => n + 1)
  }, [doc])

  const save = useCallback(async () => {
    if (!doc) return
    setSaving(true)
    try {
      const text = serialize(tidyScript(doc))
      await ppost(o.project, 'ext/gt/file', { root: o.root, path: o.path, action: 'save', text, expectText: base })
      setBase(text)
      saved.current = doc
      bump((n) => n + 1)
    } catch (e) {
      h().toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }, [doc, base, o.project, o.root, o.path])

  return {
    doc,
    base,
    dirty: !!doc && doc !== saved.current,
    error,
    loading,
    saving,
    selected,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    apply,
    select: setSelected,
    undo,
    redo,
    save,
    reload,
  }
}
