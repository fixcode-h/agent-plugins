import type { Project } from '../shared/schema.ts'
import type { Textifier, TextifyFile } from '../../sdk/server.ts'
import type { SheetData } from '../shared/files.ts'
import { TableSchema, tablesOf } from '../shared/tables.ts'
import { workbookDiffText } from '../shared/review-tables.ts'
import { parseTableBuffer } from './tables/files.ts'
import { readSchema, schemaDir } from './tables/schema-store.ts'

type Projects = { get(id: string): Promise<Project | null> }

/**
 * 评审里的表格差异（面板 ServerPlugin.textify，插件接口 6）：git diff 对 .xlsx 只有「二进制文件不同」，
 * 这里两版各自解析成工作表，按格子比（textify.diff）。用项目的表格结构（表头规则、主键），评审看到的行和字段名与表格页一致；
 * 项目没开表格功能、结构文件读不到时按自动识别。原来面板自带表格时在面板 server/exec/review-semantic.ts 里
 */
export function reviewTextifier(projects: Projects): Textifier {
  const schemaOf = async (f: TextifyFile) => {
    const cfg = tablesOf(await projects.get(f.project.id).catch(() => null))
    if (!cfg || !f.project.path) return TableSchema.parse({})
    return readSchema(schemaDir(f.project.path, f.project.id, cfg)).catch(() => TableSchema.parse({}))
  }
  const sheetsOf = async (file: string, buf: Buffer | null): Promise<SheetData[] | null> =>
    buf ? (await parseTableBuffer(file, buf)).sheets : null
  return {
    exts: ['xlsx', 'xlsm'],
    how: '表格，按格子比较',
    // 面板只在没有 diff 时逐行比；这里也给一份整本的文本（每行一格一格用制表符隔开），留着给只要文本的地方
    text: async ({ path, data }) =>
      ((await sheetsOf(path, data)) ?? [])
        .map((s) => `# ${s.name}\n${s.rows.map((r) => r.join('\t')).join('\n')}`)
        .join('\n\n'),
    diff: async (f, old, next) => {
      const [schema, a, b] = await Promise.all([schemaOf(f), sheetsOf(f.path, old), sheetsOf(f.path, next)])
      return workbookDiffText(f.path, a, b, schema)
    },
  }
}
