import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getCapture, profilingDir } from '../captures.ts'
import { BridgeError } from '../instances.ts'
import type { OpCtx } from '../ops.ts'
import type { TraceRes } from '../trace-query.ts'
import { t } from '../util.ts'
import { framesOf, laneIds, q, rangeOf, timeArgs, type Q, type TimerRow } from './trace-common.ts'
import { frameStatsOf } from './trace-frames.ts'

/**
 * 把完整数据写成文件（设计稿 4.3 export）：工具结果限长，Agent 要自己算（画图、跑脚本、和别的数据对）时导出成 CSV / JSON，
 * 只回路径和行数（ADR 0067：长内容写文件）。文件放项目的 Saved/Profiling/AgentPanel/exports。
 */

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(rows: Record<string, unknown>[]) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n')
}

async function rowsOf(ctx: OpCtx, id: string, what: string, qy: Q): Promise<Record<string, unknown>[]> {
  const r = await rangeOf(ctx, id, qy)
  switch (what) {
    case 'frames': {
      // 每帧一行：帧号、开始秒、帧时长，加上各线程忙的毫秒
      const f = await framesOf(ctx, id)
      const fs = await frameStatsOf(ctx, id)
      const rows: Record<string, unknown>[] = []
      for (let i = 0; i < f.ms.length; i++) {
        if (r.t0 !== undefined && f.start[i] < r.t0) continue
        if (r.t1 !== undefined && f.start[i] > r.t1) continue
        const row: Record<string, unknown> = { frame: i, start: f.start[i], ms: f.ms[i] }
        const k = i - fs.f0
        for (const l of fs.lanes) if (k >= 0 && k < l.busy.length) row[l.name] = l.busy[k]
        rows.push(row)
      }
      return rows
    }
    case 'timers': {
      const lanes = await laneIds(ctx, id, qy.lane)
      const res = (await q(ctx, id, {
        what: 'timers',
        ...timeArgs(r),
        top: 5000,
        ...(lanes ? { lanes } : {}),
        ...(qy.lua === true || qy.lua === 'true' ? { lua: true } : {}),
      })) as TraceRes & { items: TimerRow[] }
      return res.items.map((x) => ({ ...x }))
    }
    case 'counters': {
      if (!qy.name) throw new BridgeError(t('导出计数器要给 name（逗号分隔可写多个）'))
      const names = String(qy.name)
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
      const res = (await q(ctx, id, { what: 'counters', names, ...timeArgs(r), px: 4000 })) as TraceRes & {
        series: { name: string; t: number[]; v: number[] }[]
      }
      return res.series.flatMap((s) => s.t.map((x, i) => ({ counter: s.name, t: x, v: s.v[i] })))
    }
    case 'log': {
      const res = (await q(ctx, id, { what: 'log', ...timeArgs(r), top: 20000 })) as TraceRes & {
        items: { t: number; v: string; c: string; m: string }[]
      }
      return res.items.map((x) => ({ t: x.t, verbosity: x.v, category: x.c, message: x.m }))
    }
    default:
      throw new BridgeError(t('export 的 what：frames / timers / counters / log'))
  }
}

export async function exportTrace(ctx: OpCtx, id: string, qy: Q) {
  const what = String(qy.what ?? 'frames')
  const format = qy.format === 'json' ? 'json' : 'csv'
  const rows = await rowsOf(ctx, id, what, qy)
  const cap = await getCapture(ctx.project, id)
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
  const file = path.join(profilingDir(ctx.project), 'AgentPanel', 'exports', `${cap.id}-${what}-${stamp}.${format}`)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, format === 'json' ? JSON.stringify(rows) : toCsv(rows), 'utf8')
  return {
    file,
    rows: rows.length,
    columns: [...new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r)))],
    note: '时间单位：t / start 是秒，耗时是毫秒。用读文件或脚本处理，不要整份读进对话',
  }
}
