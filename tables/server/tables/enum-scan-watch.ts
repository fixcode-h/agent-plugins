/**
 * 枚举扫描的「盯着改动」（auto = watch，用户 2026-11-14：某些定义下后台自动刷新检测）：
 * 面板在后台盯着规则用到的源文件，一改就按规则重扫，扫出变化经推送通道（enum-scan 事件）告诉所有页面。
 *
 * - 盯的是规则文件通配的起始目录（watchRoots），整棵树的监听走面板共用的 server/watch/tree；
 *   一个项目的几条规则共用目录时只开一个。
 * - 事件来了不马上扫：编辑器保存、版本控制更新会连着来一串，等它停 SETTLE_MS 再扫；扫之前还按修改时间比一遍
 *   （runScans 的 auto），没真变就不扫、不推。
 * - .git、node_modules、Intermediate 这类目录和点开头的目录里的事件直接丢掉（扫描本来就跳过它们，
 *   项目自己的 .agentpanel 里写扫描结果也不会反过来再触发一次）。
 * - 一个项目最多盯 MAX_ROOTS 个目录，超了只盯前面的并在日志里说；目录不存在（还没建）先跳过，下次同步再试。
 */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { PluginPages } from '../../../sdk/server.ts'
import { watchGlobs, type ScanRun } from '../../shared/table-enum-scan.ts'
import { runScans, type ScanCtx } from './enum-scan.ts'
import { SKIP_DIRS, watchRoots } from './enum-scan-files.ts'
import { watchTree } from '../watch/tree.ts'

const SETTLE_MS = 1500
const MAX_ROOTS = 16

export interface EnumScanPush {
  projectId: string
  runs: ScanRun[]
}

interface ProjectWatch {
  /** 目录 → watcher */
  roots: Map<string, Closable>
  timer?: ReturnType<typeof setTimeout>
}

export interface EnumScanWatchDeps {
  pages: PluginPages | undefined
  /** 项目的扫描上下文（每次扫都重新取：规则、项目设置可能刚改过）；项目没了返回 null */
  ctxOf: (projectId: string) => Promise<ScanCtx | null>
  /** 所有项目的 id（插件启动时全量同步一次） */
  projectIds: () => Promise<string[]>
  /** 单测里换掉 fs.watch */
  watchFn?: (dir: string, on: (file: string) => void) => Closable | undefined
  log?: (msg: string) => void
}

/** 事件里的相对路径落在要跳过的目录里 */
export function ignoredChange(rel: string) {
  return rel
    .replace(/\\/g, '/')
    .split('/')
    .slice(0, -1)
    .some((s) => SKIP_DIRS.has(s) || s.startsWith('.'))
}

/** 盯得住的句柄：共用监听返回的和单测换进来的假监听都只要 close */
export interface Closable {
  close(): void
}

/**
 * 整棵目录树的监听走面板共用的 server/watch/tree（ADR 0074）：Windows / macOS 一个递归句柄，
 * Linux 逐个目录盯（Node 在 Linux 上的递归监听按文件盯，改名替换保存后会盯丢，2026-11-14 实测）。
 * 盯不了（目录没了、网络盘）返回空，下次同步再试
 */
export function treeWatch(root: string, on: (file: string) => void): Closable | undefined {
  return watchTree(root, (rel) => on(rel ?? ''), {
    skipDir: (name) => SKIP_DIRS.has(name) || name.startsWith('.'),
  })
}

export function enumScanWatcher(deps: EnumScanWatchDeps) {
  const projects = new Map<string, ProjectWatch>()
  const watchFn = deps.watchFn ?? treeWatch
  const log = deps.log ?? ((m: string) => console.warn(`[tables] ${m}`))

  const scan = async (projectId: string) => {
    const ctx = await deps.ctxOf(projectId).catch(() => null)
    if (!ctx) return
    const ids = ctx.schema.scans.filter((s) => s.auto === 'watch').map((s) => s.id)
    if (!ids.length) return
    const runs = await runScans(ctx, { ids, auto: true }).catch((e: Error) => {
      log(`枚举扫描失败：${e.message}`)
      return [] as ScanRun[]
    })
    if (runs.length) deps.pages?.push('enum-scan', { projectId, runs } satisfies EnumScanPush)
  }

  const poke = (projectId: string) => {
    const p = projects.get(projectId)
    if (!p) return
    if (p.timer) clearTimeout(p.timer)
    p.timer = setTimeout(() => {
      p.timer = undefined
      void scan(projectId)
    }, SETTLE_MS)
  }

  const drop = (projectId: string) => {
    const p = projects.get(projectId)
    if (!p) return
    if (p.timer) clearTimeout(p.timer)
    for (const w of p.roots.values()) w.close()
    projects.delete(projectId)
  }

  /** 按项目现在的规则重新算要盯的目录：新的开、不要的关 */
  const sync = async (projectId: string) => {
    const ctx = await deps.ctxOf(projectId).catch(() => null)
    const rules = ctx?.schema.scans.filter((s) => s.auto === 'watch') ?? []
    if (!ctx || !rules.length) return drop(projectId)
    const want = watchRoots(
      ctx.dir,
      rules.flatMap((r) => watchGlobs(r.from)),
    )
    // 外层目录已经递归盯着时，里面的不用再开
    const roots = want.filter((d) => !want.some((o) => o !== d && d.startsWith(o + path.sep)))
    if (roots.length > MAX_ROOTS) log(`项目 ${projectId} 的枚举扫描要盯 ${roots.length} 个目录，只盯前 ${MAX_ROOTS} 个`)
    const p = projects.get(projectId) ?? { roots: new Map<string, Closable>() }
    projects.set(projectId, p)
    const keep = new Set(roots.slice(0, MAX_ROOTS))
    for (const [d, w] of p.roots)
      if (!keep.has(d)) {
        w.close()
        p.roots.delete(d)
      }
    for (const d of keep) {
      if (p.roots.has(d)) continue
      const isDir = await stat(d)
        .then((s) => s.isDirectory())
        .catch(() => false)
      if (!isDir) continue
      const w = watchFn(d, (f) => {
        if (!f || !ignoredChange(f)) poke(projectId)
      })
      if (w) p.roots.set(d, w)
      else log(`盯不了目录 ${d}`)
    }
  }

  return {
    sync,
    /** 插件启动时：所有项目同步一次 */
    syncAll: async () => {
      for (const id of await deps.projectIds().catch(() => [] as string[])) await sync(id)
    },
    /** 正在盯着的目录（单测、排查用） */
    roots: (projectId: string) => [...(projects.get(projectId)?.roots.keys() ?? [])],
    close: () => {
      for (const id of [...projects.keys()]) drop(id)
    },
  }
}

export type EnumScanWatcher = ReturnType<typeof enumScanWatcher>
