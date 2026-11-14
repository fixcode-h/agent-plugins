/**
 * 枚举扫描结果的存取（结构文件目录下的 enum-scan-results.json）。和规则（enum-scans.json）分开：
 * 规则是人改的，结果只在扫描时写，两边不会互相盖掉。结果也跟着结构文件走（存在项目目录时能提交，
 * 同事拉下来不扫也能用下拉和检查）。
 */
import path from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { ScanResult, type ScanResults } from '../../shared/table-enum-scan.ts'
import type { TableSchema } from '../../shared/tables.ts'

const FILE = 'enum-scan-results.json'

export async function readScanResults(dir: string): Promise<ScanResults> {
  const text = await readFile(path.join(dir, FILE), 'utf8').catch(() => '')
  if (!text) return {}
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    const out: ScanResults = {}
    // 一条坏了只丢那一条
    for (const [k, v] of Object.entries(raw ?? {})) {
      const got = ScanResult.safeParse(v)
      if (got.success) out[k] = got.data
    }
    return out
  } catch {
    return {}
  }
}

export async function writeScanResults(dir: string, r: ScanResults) {
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, FILE)
  const text = `${JSON.stringify(r, null, 2)}\n`
  const old = await readFile(file, 'utf8').catch(() => null)
  if (old === text) return
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, text)
  await rename(tmp, file)
}

/**
 * 扫描结果并进各个枚举的 scanned。按规则的顺序：两条规则扫出同名枚举时前面的算数；
 * 规则已经删了的结果不并（结果文件里留着也无妨，下次扫描时清掉）
 */
export function mergeScanned(schema: TableSchema, results: ScanResults): TableSchema {
  if (!schema.scans.length) return schema
  const enums = { ...schema.enums }
  const taken = new Set<string>()
  for (const s of schema.scans) {
    const r = results[s.id]
    if (!r) continue
    for (const [name, values] of Object.entries(r.enums)) {
      if (taken.has(name)) continue
      taken.add(name)
      enums[name] = { ...(enums[name] ?? { values: [] }), scanned: { by: s.id, values } }
    }
  }
  return { ...schema, enums }
}

/** 写 enums.json 前去掉扫描结果；只靠扫描才有的枚举（没手写成员、没指向枚举表）整个不写 */
export function stripScanned(schema: TableSchema): TableSchema {
  const enums: TableSchema['enums'] = {}
  for (const [k, e] of Object.entries(schema.enums)) {
    const { scanned, ...rest } = e
    if (scanned && !rest.values.length && !rest.source) continue
    enums[k] = rest
  }
  return { ...schema, enums }
}
