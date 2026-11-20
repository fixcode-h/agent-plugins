import { useMemo, useState } from 'react'
import { sourceOf } from '../../../../../shared/forge-doc/include.ts'
import type { PathSeg } from '../../../../../shared/forge-doc/locate.ts'
import { applyPlan, planEdit } from '../../../../../shared/umg-schema/node-edit.ts'
import { ppost } from '../../../../api.ts'
import { looksLikePath } from '../../../../details/model.ts'
import type { DetailsApi, Node } from '../../../../details/rows.tsx'
import { t } from '../../../../host.ts'
import type { ConfigEdit } from './ctx.ts'
import { splitPath, type NodeProps } from './node-props.ts'

/** 细节面板上填的文字换成配置里的值：按这一行的类型（不像 UE 桥接那样把 { 开头的文字当 JSON） */
export function parseRaw(n: Pick<Node, 'type' | 'value'>, raw: string): unknown {
  const ty = n.type ?? ''
  if (ty === 'bool' || typeof n.value === 'boolean') return raw === 'true'
  if (/^(int|float|double)/.test(ty) || typeof n.value === 'number') {
    const v = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(v)) throw new Error(t('「{v}」不是数字', { v: raw }))
    return /^int/.test(ty) ? Math.round(v) : v
  }
  // 向量、颜色、边距：数字框交上来的是整个结构体的 JSON
  if (n.value && typeof n.value === 'object') return JSON.parse(raw) as unknown
  return raw
}

/**
 * 按配置改一个控件节点的细节面板动作：改值、重置为默认都直接改 AssetForge 配置文件（不经 UE）。
 * 每次改都先重读那份文件（拿最新原文和修改时间）、只改那一个字段、带着修改时间存回去：中间被别人存过就报错不覆盖。
 * 节点来自 include 的片段时改片段文件（sourceOf 查）。出错原样交给页面显示。
 */
export function useNodeEdit(a: {
  edit: ConfigEdit | null
  /** 节点在展开后配置里的路径（['root','children',0,…]） */
  at?: PathSeg[]
  node: unknown
  styles: unknown
  np: NodeProps
  onOpen?: (path: string) => void
}): { api: Omit<DetailsApi, 'q'>; error: string; clearError: () => void } {
  const { edit, at, node, styles, np, onOpen } = a
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)

  const api = useMemo<Omit<DetailsApi, 'q'>>(() => {
    const write = async (path: string, next: () => unknown) => {
      if (!edit || !at) return
      setBusy(path)
      setError('')
      try {
        const { field, segs } = splitPath(path)
        const plan = planEdit({ node, styles, defs: np.defs[field], field, segs, next: next() })
        if (!plan) return
        const src = sourceOf(edit.expanded, at, edit.main)
        const r = await ppost<{ text: string; mtime: string }>(edit.project, 'ext/forge/read', {
          root: edit.configRoot,
          path: src.file,
        })
        const text = applyPlan(r.text, src.path, field, plan)
        if (text === r.text) return
        await ppost(edit.project, 'ext/forge/save', { root: edit.configRoot, path: src.file, text, mtime: r.mtime })
        setVersion((v) => v + 1)
        edit.onSaved()
      } catch (e) {
        setError(`${path}：${(e as Error).message}`)
      } finally {
        setBusy('')
      }
    }
    return {
      busy,
      version,
      resetToDefault: true,
      isDefault: np.isDefault,
      isChanged: np.isChanged,
      changed: np.defaultOf,
      setValue: (n, raw) => void write(n.path, () => parseRaw(n, raw)),
      reset: (n) => void write(n.path, () => np.defaultOf(n.path)),
      arrayOp: () => undefined,
      openRef: (p) => (onOpen && looksLikePath(p) ? () => onOpen(p) : undefined),
      loadFull: async () => undefined,
    }
  }, [edit, at, node, styles, np, onOpen, busy, version])
  return { api, error, clearError: () => setError('') }
}
