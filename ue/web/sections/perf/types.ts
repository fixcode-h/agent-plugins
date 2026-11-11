/** 性能页网页端用的数据形状（服务端 captures.ts、perf.ts、perf-live.ts 返回的） */
export type { LiveRes } from '../../../server/perf-live.ts'

export interface Capture {
  id: string
  kind: 'csv' | 'memreport' | 'trace'
  label?: string
  file: string
  sizeKB: number
  at: string
  by?: string
  marks?: { at: number; name: string }[]
  imported?: boolean
}
export interface Active {
  id: string
  label: string
  seconds: number
  elapsed: number
  startedAt: string
  marks: { at: number; name: string }[]
}
export interface PerfState {
  items: Capture[]
  totalKB: number
  active: Active[]
}
export interface Stat {
  avg: number
  p95: number
  p99: number
  max: number
}
export interface CsvSummary {
  frames: number
  seconds: number
  fps?: { avg: number; p95Low: number; p99Low: number }
  key: Record<string, Stat>
  hitches: { thresholdMs: number; count: number; worst: { frame: number; at: number; ms: number }[] }
  events: { at: number; name: string }[]
  columns: number
  meta?: Record<string, string>
  note?: string
}
export interface MemSummary {
  header: string[]
  sections: { command: string; lines: number }[]
  objects?: { columns: string[]; rows: (string | number)[][] }
}
export interface Series {
  column: string
  series: { at: number; avg: number; max: number }[]
}

const fileName = (f: string) => f.split(/[\\/]/).pop() ?? f
export const nameOf = (c: Capture) => c.label || fileName(c.file)
export { fileName }
