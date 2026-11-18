import { useEffect, useState } from 'react'
import { op, ppost } from '../../../api.ts'

/**
 * 接口库的一项（协议第 8 节 gt.api 的返回、_api.json 的 items 合成同一种形状）：
 * 自带接口只能从 GameTest 取（编辑器开着），项目接口编辑器没开时从 _api.json 读
 */
export interface ApiArg {
  name: string
  type?: string
  note?: string
  constructible?: boolean
  why?: string
}

export interface ApiItem {
  name: string
  category?: string
  src: 'builtin' | 'cpp' | 'lua' | 'script'
  display?: string
  sig?: string
  args?: ApiArg[]
  returns?: string
  readOnly: boolean
  note?: string
  file?: string
  line?: number
}

export interface ApiRejected {
  class?: string
  module?: string
  function: string
  why: string
  file?: string
  line?: number
  src: 'cpp' | 'lua'
}

interface ApiFileSection {
  scannedAt?: string
  folders?: string[]
  items?: Record<string, unknown>[]
  rejected?: Record<string, unknown>[]
}

export interface ApiFile {
  path: string
  exists: boolean
  doc: { cpp?: ApiFileSection; lua?: ApiFileSection; renamed?: Record<string, string> }
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

/** _api.json 的一段 → 接口项 */
export function itemsOfFile(f: ApiFile | undefined): ApiItem[] {
  const out: ApiItem[] = []
  for (const src of ['cpp', 'lua'] as const)
    for (const it of f?.doc[src]?.items ?? [])
      out.push({
        name: String(it.name ?? ''),
        category: str(it.category),
        src,
        display: str(it.display),
        args: Array.isArray(it.args) ? (it.args as ApiArg[]) : [],
        returns: str(it.returns),
        readOnly: it.readOnly === true,
        note: str(it.note),
        file: str(it.file),
        line: typeof it.line === 'number' ? it.line : undefined,
      })
  return out
}

export function rejectedOfFile(f: ApiFile | undefined): ApiRejected[] {
  const out: ApiRejected[] = []
  for (const src of ['cpp', 'lua'] as const)
    for (const it of f?.doc[src]?.rejected ?? [])
      out.push({
        class: str(it.class),
        module: str(it.module),
        function: String(it.function ?? ''),
        why: String(it.why ?? ''),
        file: str(it.file),
        line: typeof it.line === 'number' ? it.line : undefined,
        src,
      })
  return out
}

/** 参数写法：给补全和节点上显示 */
export const sigOf = (it: ApiItem) =>
  it.sig ?? `${it.name}(${(it.args ?? []).map((a) => a.name).join(', ')})${it.returns ? ` → ${it.returns}` : ''}`

/**
 * 编辑页用的接口清单：编辑器开着时问 GameTest（自带 + 项目，gt.api 分页取完），没开时只有 _api.json 里的项目接口。
 * 旧版 GameTest 没有 gt.api 时同样退回读文件
 */
export function useApis(project: string, root: string, live: boolean) {
  const [items, setItems] = useState<ApiItem[]>([])
  const [file, setFile] = useState<ApiFile>()
  const [error, setError] = useState('')
  const [seq, setSeq] = useState(0)
  useEffect(() => {
    if (!root) return
    let off = false
    void (async () => {
      const f = await ppost<ApiFile>(project, 'ext/gt/api', { root, action: 'file' }).catch((e: Error) => {
        setError(e.message)
        return undefined
      })
      if (off) return
      setFile(f)
      let list = itemsOfFile(f)
      if (live) {
        try {
          const got: ApiItem[] = []
          for (let offset = 0; offset < 2000;) {
            const r = await op<{ items: ApiItem[]; hasMore?: boolean }>(project, 'gt.api', { offset, limit: 200 })
            got.push(...(r.items ?? []))
            if (!r.hasMore) break
            offset += 200
          }
          if (got.length) list = got
          setError('')
        } catch (e) {
          // 旧版 GameTest 没有这个操作：只显示文件里的项目接口
          setError((e as Error).message)
        }
      }
      if (!off) setItems(list)
    })()
    return () => {
      off = true
    }
  }, [project, root, live, seq])
  return { items, file, error, reload: () => setSeq((n) => n + 1) }
}
