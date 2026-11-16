import { useEffect, useSyncExternalStore } from 'react'
import type { BuildSummary, ChangedFile } from '../../../server/lua-build/changes.ts'
import type { LuaBuildConfig, LuaBuildError, LuaBuildRun } from '../../../server/types.ts'
import { pget, ppost } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'

/**
 * Lua 编译的网页状态（服务端 server/lua-build/）。页头的「增量编译 · N」「全编译」按钮和「编译」页签都要用，
 * 放进模块级的小仓库：一个项目一份，接口取一次，之后靠推送（事件 ue-lua-build）追加输出，不轮询。
 */
export interface BuildCurrent extends LuaBuildRun {
  lines: string[]
  droppedLines: number
}

export interface BuildSnap {
  config: LuaBuildConfig
  scriptDirExists: boolean
  changes: {
    files: ChangedFile[]
    total: number
    baseline: number | null
    last: { full?: BuildSummary; incremental?: BuildSummary }
    p4Error?: string
  }
  current?: BuildCurrent
}

interface Entry {
  snap?: BuildSnap
  error?: string
  loading?: boolean
  /** 加载途中又来了接不上的推送：加载完再取一次 */
  stale?: boolean
  /** 增量编译时勾掉不编的文件 */
  skipped: Set<string>
}

const MAX_LINES = 5000
const byProject = new Map<string, Entry>()
const subs = new Set<() => void>()
let version = 0

const entry = (id: string) => {
  let e = byProject.get(id)
  if (!e) byProject.set(id, (e = { skipped: new Set() }))
  return e
}

function emit() {
  version++
  for (const f of subs) f()
}

const subscribe = (f: () => void) => {
  subs.add(f)
  return () => void subs.delete(f)
}

export async function loadBuild(projectId: string): Promise<void> {
  const e = entry(projectId)
  if (e.loading) {
    e.stale = true
    return
  }
  e.loading = true
  e.stale = false
  emit()
  try {
    e.snap = await pget<BuildSnap>(projectId, 'lua-build')
    e.error = undefined
  } catch (err) {
    e.error = (err as Error).message
  } finally {
    e.loading = false
    emit()
  }
  if (e.stale) return loadBuild(projectId)
}

interface PushData {
  project: string
  id: string
  /** 这批输出从第几行起（从 0 数） */
  from: number
  lines: string[]
  errors: LuaBuildError[]
  run?: LuaBuildRun
}

let listening = false
/** 推送只订一次（页头和页签都挂着也不重复追加） */
function listen() {
  if (listening) return
  listening = true
  h().events.on('ue-lua-build', (raw) => {
    const d = raw as PushData
    const e = byProject.get(d?.project)
    if (!e?.snap) return
    const cur = e.snap.current
    // 不是网页上正看着的这次（Agent 起的、别的标签页起的）：重取一次接上
    if (!cur || cur.id !== d.id) return void loadBuild(d.project)
    const have = cur.droppedLines + cur.lines.length
    // 中间漏了一批（推送断过）：重取一次；重叠的部分（刚取过快照）跳过
    if (d.from > have) return void loadBuild(d.project)
    const lines = cur.lines.concat(d.lines.slice(have - d.from))
    const drop = Math.max(0, lines.length - MAX_LINES)
    e.snap = {
      ...e.snap,
      current: {
        ...cur,
        ...(d.run ?? {}),
        errors: d.errors,
        lines: drop ? lines.slice(drop) : lines,
        droppedLines: cur.droppedLines + drop,
      },
    }
    emit()
    // 编完了：改过的文件、上次编译的记录都变了
    if (d.run && d.run.status !== 'running') void loadBuild(d.project)
  })
}

/** 取这个项目的编译状态；第一次用到时加载 */
export function useLuaBuild(projectId: string) {
  useSyncExternalStore(subscribe, () => version)
  useEffect(() => {
    listen()
    const e = entry(projectId)
    if (!e.snap && !e.loading) void loadBuild(projectId)
  }, [projectId])
  const e = entry(projectId)
  const files = e.snap?.changes.files ?? []
  const picked = files.filter((f) => !e.skipped.has(f.path)).map((f) => f.path)
  return {
    ...e,
    picked,
    running: e.snap?.current?.status === 'running',
    toggle(path: string, on: boolean) {
      if (on) e.skipped.delete(path)
      else e.skipped.add(path)
      emit()
    },
    reload: () => loadBuild(projectId),
    async start(mode: 'full' | 'incremental') {
      await ppost(projectId, 'lua-build/run', { mode, ...(mode === 'incremental' ? { files: picked } : {}) })
      // 推送可能比这个回复先到：不自己拼，重取一次快照，之后的推送按行号接上
      await loadBuild(projectId)
    },
    stop: () => ppost(projectId, 'lua-build/stop'),
    open: (file: string, line: number) => ppost(projectId, 'lua-build/open', { file, line }),
  }
}

/** 「编译」页签上的标记：编译中显示「…」，上次失败显示错误数（加提示点） */
export function useBuildBadge() {
  const { project } = useUe()
  const cur = useLuaBuild(project.id).snap?.current
  if (cur?.status === 'running') return { text: '…', hint: t('编译中') }
  if (cur?.status === 'failed')
    return { text: String(cur.errors.length || '!'), tone: 'danger' as const, hint: t('上次编译失败') }
  return undefined
}
