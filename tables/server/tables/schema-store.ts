/**
 * 表格的结构文件：表头、枚举、列的结构。全部存在表格之外——
 * 项目目录 .agentpanel/tables/（能提交给团队）或数据目录 tables/<项目 id>/（只在本机），由项目设置决定。
 * 拆成几个文件（types.json 是类型表，enum-scans.json 是枚举扫描规则，扫描结果在 enum-scan-results.json），多人各改各的部分不容易冲突；JSON 两格缩进，版本控制里看得出改了什么。
 * 旧版还有 files.json（单张表的表头覆盖）：读的时候并进 style 的「按文件指定」，下次保存时删掉。
 */
import path from 'node:path'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { TableSchema, type TablesConfig } from '../../shared/tables.ts'
import { EnumScan } from '../../shared/table-enum-scan.ts'
import { upgradeSchemaRaw } from '../../shared/table-schema-upgrade.ts'
import { DATA_DIR } from '../store.ts'
import { mergeScanned, readScanResults, stripScanned } from './enum-scan-store.ts'

/** 结构文件的几部分：文件名 → TableSchema 里的键（扫描规则存 enum-scans.json） */
const PARTS = ['style', 'enums', 'columns', 'types', 'enum-scans'] as const
const KEY: Record<(typeof PARTS)[number], string> = {
  style: 'style',
  enums: 'enums',
  columns: 'columns',
  types: 'types',
  'enum-scans': 'scans',
}
/** 旧版的单表表头覆盖，只读不写 */
const LEGACY = 'files'

export function schemaDir(projectDir: string, projectId: string, cfg: Pick<TablesConfig, 'store'>) {
  return cfg.store === 'data'
    ? path.join(DATA_DIR, 'tables', projectId)
    : path.join(projectDir, '.agentpanel', 'tables')
}

export async function readSchema(dir: string): Promise<TableSchema> {
  const raw: Record<string, unknown> = {}
  for (const p of [...PARTS, LEGACY]) {
    const text = await readFile(path.join(dir, `${p}.json`), 'utf8').catch(() => '')
    if (!text) continue
    try {
      const v = JSON.parse(text) as unknown
      // style.json 里还顺带记分析时间
      if (p === 'style' && v && typeof v === 'object' && 'analyzedAt' in v) {
        const { analyzedAt, ...rest } = v as Record<string, unknown>
        raw.analyzedAt = analyzedAt
        raw.style = rest
      } else raw[p === LEGACY ? p : KEY[p as (typeof PARTS)[number]]] = v
    } catch {
      // 手改坏了的文件当没有，不让整个表格页打不开
    }
  }
  // 扫描规则一条写坏了（手改、新版加的写法）只丢那一条，不让整份结构文件作废
  if (Array.isArray(raw.scans)) raw.scans = raw.scans.filter((x) => EnumScan.safeParse(x).success)
  const got = TableSchema.safeParse(upgradeSchemaRaw(raw))
  // 扫描结果单独一个文件（只在扫描时写），读的时候并进各个枚举的 scanned
  return mergeScanned(got.success ? got.data : TableSchema.parse({}), await readScanResults(dir))
}

async function writeAtomic(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, text)
  await rename(tmp, file)
}

/** 整份写回；内容没变的部分不写（不让版本控制里出现无意义的改动） */
export async function writeSchema(dir: string, s: TableSchema) {
  // 页面交回来的枚举带着扫描结果（scanned）：结果不归这里写，去掉；只靠扫描才有的枚举整个不写
  const next = stripScanned(TableSchema.parse(s))
  await mkdir(dir, { recursive: true })
  const body: Record<(typeof PARTS)[number], unknown> = {
    style: next.analyzedAt ? { ...next.style, analyzedAt: next.analyzedAt } : next.style,
    enums: next.enums,
    columns: next.columns,
    types: next.types,
    'enum-scans': next.scans,
  }
  for (const p of PARTS) {
    const file = path.join(dir, `${p}.json`)
    const text = `${JSON.stringify(body[p], null, 2)}\n`
    const old = await readFile(file, 'utf8').catch(() => null)
    if (old === text) continue
    // 空的部分且文件本来就没有：不建空文件
    if (old === null && (text === '{}\n' || text === '[]\n')) continue
    await writeAtomic(file, text)
  }
  // 旧版的单表覆盖已经并进 style 写下去了：留着的话下次读又会并一遍，用户在设置里删掉的又回来
  await rm(path.join(dir, `${LEGACY}.json`), { force: true })
  return mergeScanned(next, await readScanResults(dir))
}
