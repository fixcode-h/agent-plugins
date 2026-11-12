/**
 * 表格页的草稿（table-drafts.ts）怎么跟着页面走：
 * - 打开一个文件时看有没有上次留下的草稿，有就先问（DraftBar），问完之前不动这份草稿；
 * - 问过的（或本来就没有草稿的）文件，改动停手一会儿就写进草稿，改动清空（保存、撤销到底、丢掉）就删掉草稿；
 * - 页面藏起来、关掉、换项目时立刻写一次，不等停手。
 * 写草稿要算一遍「改了哪些格子」，所以只算改动变了的那个文件，并且停手 400ms 再算。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { TableDoc } from '@shared/tables'
import { toast } from '@/lib/toast'
import type { Edits } from './table-edits'
import { draftOf, dropDraft, getDraft, listDrafts, putDraft, restoreEdits, type Draft } from './table-drafts'

/** 停手多久写草稿 */
const QUIET_MS = 400

export function useTableDrafts({
  projectId,
  docs,
  edits,
  setEdits,
}: {
  projectId: string
  docs: Record<string, TableDoc | { error: string }>
  edits: Record<string, Edits>
  setEdits: (f: (m: Record<string, Edits>) => Record<string, Edits>) => void
}) {
  /** 打开了、有草稿、还没决定恢复还是丢掉的文件 */
  const [asks, setAsks] = useState<Record<string, Draft>>({})
  /** 浏览器里存着草稿的文件（文件树上标点，没打开的也算） */
  const [stored, setStored] = useState<Set<string>>(() => new Set())
  /** 已经看过有没有草稿、并且决定了（或者本来就没有）的文件：只有这些才跟着改动写草稿 */
  const settled = useRef(new Set<string>())
  /** 正在看有没有草稿的文件 */
  const checking = useRef(new Set<string>())
  /** 上次写草稿时的改动和文件：没变的不再算 */
  const synced = useRef(new Map<string, { e: Edits | undefined; doc: TableDoc }>())

  const mark = (path: string, on: boolean) =>
    setStored((s) => {
      if (s.has(path) === on) return s
      const n = new Set(s)
      if (on) n.add(path)
      else n.delete(path)
      return n
    })

  // 进表格页（换项目）时列一遍草稿：文件树上标出来，提醒一句
  useEffect(() => {
    let live = true
    void listDrafts(projectId).then((list) => {
      if (!live || !list.length) return
      setStored(new Set(list.map((d) => d.path)))
      toast.info(t('有 {n} 个表格有上次没保存的改动', { n: list.length }), {
        description: t('文件树上带点的就是，打开时可以选择恢复。'),
      })
    })
    return () => {
      live = false
    }
  }, [projectId])

  // 文件读到了：看有没有草稿
  useEffect(() => {
    for (const [path, d] of Object.entries(docs)) {
      if (!('sheets' in d) || settled.current.has(path) || checking.current.has(path)) continue
      checking.current.add(path)
      void getDraft(projectId, path).then((draft) => {
        checking.current.delete(path)
        if (draft && draft.sheets.length) setAsks((m) => ({ ...m, [path]: draft }))
        else settled.current.add(path)
      })
    }
    // 关掉的文件：下次打开重新看（关的时候选了「不保存」，草稿已经删了；还没决定就关了的，草稿留着）
    for (const path of [...settled.current]) if (!docs[path]) settled.current.delete(path)
    setAsks((m) => {
      const gone = Object.keys(m).filter((p) => !docs[p])
      if (!gone.length) return m
      const next = { ...m }
      for (const p of gone) delete next[p]
      return next
    })
  }, [docs, projectId])

  const sync = useCallback(() => {
    for (const path of new Set([...Object.keys(edits), ...synced.current.keys()])) {
      const doc = docs[path]
      const e = edits[path]
      const last = synced.current.get(path)
      if (!doc || !('sheets' in doc)) {
        // 写过草稿的文件关了：改动跟着页签一起丢了（有改动时关之前确认过），草稿也删
        if (last) {
          synced.current.delete(path)
          void dropDraft(projectId, path)
          mark(path, false)
        }
        continue
      }
      if (!settled.current.has(path)) continue
      if (last && last.e === e && last.doc === doc) continue
      synced.current.set(path, { e, doc })
      const draft = draftOf(projectId, doc, e)
      if (draft) void putDraft(draft)
      else void dropDraft(projectId, path)
      mark(path, !!draft)
    }
  }, [edits, docs, projectId])

  // 改动停手一会儿写草稿
  const latest = useRef(sync)
  latest.current = sync
  useEffect(() => {
    const timer = setTimeout(() => latest.current(), QUIET_MS)
    return () => clearTimeout(timer)
  }, [edits, docs])
  // 页面藏起来、关掉、换项目（卸载）时不等停手，马上写
  useEffect(() => {
    const now = () => latest.current()
    const hidden = () => document.visibilityState === 'hidden' && now()
    window.addEventListener('pagehide', now)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('pagehide', now)
      document.removeEventListener('visibilitychange', hidden)
      now()
    }
  }, [])

  const settle = (path: string) => {
    setAsks(({ [path]: _, ...m }) => m)
    settled.current.add(path)
    // 让下一次同步一定重算（恢复后要按新的改动写；丢掉后改动是空的，会删草稿）
    synced.current.set(path, { e: undefined, doc: docs[path] as TableDoc })
  }
  return {
    asks,
    stored,
    /** 恢复：整份改动换成草稿里的（一步，能撤销）；keep 是冲突的格子用哪边 */
    restore: (path: string, keep: 'mine' | 'file') => {
      const draft = asks[path]
      const doc = docs[path]
      if (!draft || !doc || !('sheets' in doc)) return
      setEdits((m) => ({ ...m, [path]: restoreEdits(draft, doc, keep) }))
      settle(path)
    },
    /** 丢掉草稿（页面上现在的改动不动） */
    discard: (path: string) => {
      settle(path)
      void dropDraft(projectId, path)
      mark(path, false)
    },
  }
}
