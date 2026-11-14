import { useEffect, useRef } from 'react'
import { t } from '@shared/i18n'
import type { TableDoc, TableSchema } from '@shared/tables'
import { diffEmpty, diffLine, scanName, type ScanRun } from '@shared/table-enum-scan'
import { tablesApi } from '@/lib/tables-api'
import { putTableSchema } from '@/lib/table-schema'
import { toast } from '@/lib/toast'

const sameFile = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

/** 同一条规则同一个错误只提醒一次（每次打开表格页都弹会很烦；错误还在规则那行显示着） */
const told = new Set<string>()

/** 扫完了：有变化就重读结构文件（下拉、检查跟着变）并说一句变了什么；出错照实说 */
export async function afterScan(projectId: string, schema: TableSchema, runs: ScanRun[], tell = true) {
  const changed = runs.filter((r) => !r.error && !diffEmpty(r.diff))
  if (changed.length) putTableSchema(projectId, await tablesApi.schema(projectId))
  for (const r of tell ? changed : []) {
    const rule = schema.scans.find((s) => s.id === r.id)
    const names = [...r.diff.added, ...r.diff.changed.map((c) => c.name), ...r.diff.removed]
    toast.info(t('枚举扫描「{name}」：{what}', { name: rule ? scanName(rule) : r.id, what: diffLine(r.diff) }), {
      description: names.slice(0, 6).join('、') + (names.length > 6 ? ' …' : ''),
    })
  }
  for (const r of runs)
    if (r.error && !told.has(`${r.id}\u0000${r.error}`)) {
      told.add(`${r.id}\u0000${r.error}`)
      const rule = schema.scans.find((s) => s.id === r.id)
      toast.error(t('枚举扫描「{name}」失败：{error}', { name: rule ? scanName(rule) : r.id, error: r.error }))
    }
}

/**
 * 表格页的「打开时」自动扫描（用户 2026-11-14：每次打开那个 xlsx 都读一下枚举、更新配置）：
 * - 进表格页（换项目）时请求一次，服务端只 stat 规则用到的文件，没变不扫
 * - 打开、保存、被外面改了重新载入规则用到的文件时（它的修改时间变了）再请求一次，只看用到它的规则
 * 没有自动规则时什么都不请求
 */
export function useEnumAutoScan(
  projectId: string,
  schema: TableSchema | null,
  docs: Record<string, TableDoc | { error: string }>,
) {
  const auto = schema?.scans.filter((s) => s.auto === 'open') ?? []
  const has = auto.length > 0
  const doneFor = useRef('')
  const seen = useRef(new Map<string, string>())
  const schemaRef = useRef(schema)
  schemaRef.current = schema

  const run = (file?: string) => {
    const s = schemaRef.current
    if (!s) return
    tablesApi
      .enumScan(projectId, { auto: true, ...(file ? { file } : {}) })
      .then(({ runs }) => (runs.length ? afterScan(projectId, s, runs) : undefined))
      .catch(() => undefined)
  }

  const loaded = !!schema
  useEffect(() => {
    if (!loaded || doneFor.current === projectId) return
    doneFor.current = projectId
    seen.current.clear()
    if (has) run()
    // 每个项目进来（结构文件读到后）只看一次；之后在设置里新建 / 改了规则不在这里扫（保存规则时已经扫过）
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, loaded])

  // 规则用到的文件：修改时间变了（打开、保存、重新载入）就请求一次
  const watched = Object.values(docs).flatMap((d) =>
    'sheets' in d && auto.some((s) => sameFile(s.from.file, d.path)) ? [`${d.path}\u0000${d.mtime}`] : [],
  )
  const key = watched.join('\n')
  useEffect(() => {
    for (const w of watched) {
      const [path, mtime] = w.split('\u0000')
      const before = seen.current.get(path)
      seen.current.set(path, mtime)
      // 第一次看到是刚打开：进页面那次已经比过了的也再比一次，服务端只 stat，很便宜
      if (before !== mtime) run(path)
    }
    // 只按「哪些文件、什么修改时间」变化触发
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
