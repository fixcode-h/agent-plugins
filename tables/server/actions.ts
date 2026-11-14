import { z } from 'zod'
import type { TableDoc, TableSchema, TableSearch, TablesIndex } from '../shared/tables.ts'
import { checkTouched, headerOf, workbookNeeds } from '../shared/table-struct.ts'
import { describeSheet } from '../shared/table-describe.ts'
import { colLetters } from '../shared/table-agent.ts'
import { TableEditInput, TableQueryInput, planEdit, queryRows } from '../shared/table-agent.ts'
import type { PluginAction, PluginActionCtx as ActionCtx } from '../../sdk/server.ts'
import type { TablesCheck } from './tables/check.ts'
import { EnumScan, type ScanRun } from '../shared/table-enum-scan.ts'

/** 动作里说明给模型看的错误：面板把 message 原样交回 */
class ActionError extends Error {}

/** 和面板 defineAction 一样：参数类型按 input 推出来（插件拿不到面板的 registry，自己包一层） */
function defineAction<S extends z.ZodType>(
  a: Omit<PluginAction, 'input' | 'run'> & { input: S; run: (args: z.infer<S>, ctx: ActionCtx) => Promise<unknown> },
): PluginAction {
  return a as PluginAction
}

/** 插件自己的接口在面板里的路径：/api/plugins/tables/api/ 下挂着表格页的那一组 /tables/… */
const API = '/plugins/tables/api'

/**
 * 表格这一组（游戏配置表）：列出表格、按字段查行、按主键改格子 / 增删行、整个项目检查。
 * 读写走表格页的同一套接口：改动只写这些格子，文件仍是原来的 Excel / WPS 格式，写之前自动备份；
 * 写之前按项目的表格结构（枚举、引用、范围、主键）检查，不合规的拦下并说明。
 */

const enc = encodeURIComponent
const PID = z.string().optional().describe('项目 id；不写就是你所在的项目')

const pidOf = (id: string | undefined, ctx: ActionCtx) => {
  const pid = id || ctx.caller?.projectId
  if (!pid) throw new ActionError('要写 projectId：没有对话上下文时得指明是哪个项目')
  return pid
}

async function openSheet(pid: string, path: string, sheet: string | undefined, ctx: ActionCtx) {
  const doc = (await ctx.api('GET', `${API}/tables/${enc(pid)}/file?path=${enc(path)}`)) as TableDoc
  if (doc.kind === 'xls') throw new ActionError('老的 .xls 只能读不能在这里改，用 Excel / WPS 另存为 .xlsx')
  const s = sheet ? doc.sheets.find((x) => x.name === sheet) : doc.sheets[0]
  if (!s) throw new ActionError(`没有工作表「${sheet}」。有：${doc.sheets.map((x) => x.name).join('、')}`)
  const schema = (await ctx.api('GET', `${API}/tables/${enc(pid)}/schema`)) as TableSchema
  return { doc, sheet: s, schema, header: headerOf(schema, path, s) }
}

/** 检查、列结构要用到的别的文件（枚举表、被引用的表）：读不到的当没有 */
async function extSheets(pid: string, files: string[], ctx: ActionCtx) {
  const ext: Record<string, TableDoc['sheets'] | undefined> = {}
  for (const f of files)
    ext[f] = (
      (await ctx.api('GET', `${API}/tables/${enc(pid)}/file?path=${enc(f)}`).catch(() => null)) as TableDoc | null
    )?.sheets
  return ext
}

/** 写之前按表格结构查改到的格子，不合规就拦下、原因交给模型 */
async function mustPass(
  pid: string,
  path: string,
  doc: TableDoc,
  name: string,
  schema: TableSchema,
  plan: ReturnType<typeof planEdit>,
  ctx: ActionCtx,
) {
  const after = { name, rows: plan.after }
  const ext = await extSheets(pid, workbookNeeds(schema, path, [after]), ctx)
  const bad = checkTouched(schema, path, after, plan.touched, (f) =>
    f === path ? doc.sheets.map((s) => (s.name === name ? after : s)) : ext[f],
  )
  if (bad.length)
    throw new ActionError(
      `没有写：${bad.length} 处不符合表格结构\n${bad
        .slice(0, 30)
        .map((p) => `- 第 ${p.r + 1} 行 ${p.field}：${p.msg}`)
        .join('\n')}\n改对后再提交；用户明确要求照写时加 force: true`,
    )
}

export const tableActions: PluginAction[] = [
  defineAction({
    name: 'table.list',
    title: '列出表格',
    description: '列出项目表格目录（项目设置 → 表格）里的配置表：相对路径、格式。改表格前先用它找文件。',
    level: 'read',
    useWhen: '改表格或查数据前先找到文件路径时',
    input: z.object({ projectId: PID }),
    run: async (a, ctx) => {
      const r = (await ctx.api('GET', `${API}/tables/${enc(pidOf(a.projectId, ctx))}`)) as TablesIndex
      if (!r.dirs.length && !r.files.length) throw new ActionError('这个项目还没设表格目录（项目设置 → 表格）')
      return { dirs: r.dirs, files: r.files.map((f) => `${f.path}${f.kind === 'xls' ? '（只读）' : ''}`) }
    },
  }),
  defineAction({
    name: 'table.sample',
    title: '看一张表的表头',
    description:
      '读一张配置表的表头和前几行数据（制表符分隔，行号从 1 数），以及这张表里各个类型名出现过的值。AI 分析表格风格时一张一张用它看，不要自己写脚本解析 xlsx。',
    level: 'read',
    useWhen: '要了解一张表的表头、写法和已有取值风格时（AI 分析表格、新增行之前）',
    input: z.object({ projectId: PID, path: z.string().min(1).describe('表格的路径（table.list 列出来的）') }),
    run: async (a, ctx) =>
      (await ctx.api('GET', `${API}/tables/${enc(pidOf(a.projectId, ctx))}/sample?path=${enc(a.path)}`)) as {
        text: string
      },
  }),
  defineAction({
    name: 'table.query',
    title: '查表格里的行',
    description:
      '按字段名查一张配置表：返回字段列表、主键字段、匹配的行（Excel 行号 + 字段值）。表头按项目的表格结构识别，不用自己数第几行。读 xlsx 用它，不要自己写脚本解析。',
    level: 'read',
    useWhen: '按字段或主键查具体的行和值时',
    avoidWhen: '不知道值在哪张表时先用 table.search',
    input: TableQueryInput.extend({ projectId: PID }),
    run: async (a, ctx) => {
      const pid = pidOf(a.projectId, ctx)
      const { sheet, schema, header } = await openSheet(pid, a.path, a.sheet, ctx)
      return { sheet: sheet.name, ...queryRows(sheet.rows, header, schema.style.key, a) }
    },
  }),
  defineAction({
    name: 'table.search',
    title: '跨表找',
    description:
      '在项目所有配置表的格子里找一个值，返回每处在哪个文件、哪张表、哪一格（Excel 位置）、哪个字段、那一行的主键。' +
      '想知道某个 ID 在哪些表里被用到、某个字段名在哪张表时用它，不要一张张 table.query。' +
      'q 写成「字段名:值」（例如 ItemId:1001）只在叫这个名字的列里找；whole 整格相同才算（数组列 1001;1002 里某一项相同也算）。',
    level: 'read',
    useWhen: '知道一个值（id、名字）但不知道在哪张表、哪一格时',
    input: z.object({
      projectId: PID,
      q: z.string().trim().min(1).max(500).describe('要找的值；「字段名:值」只在那一列找'),
      field: z.string().max(200).optional().describe('只在这个字段里找（和在 q 里写「字段名:」一样）'),
      whole: z.boolean().default(false).describe('整格相同才算（找 ID 时一般要开）'),
      caseSensitive: z.boolean().default(false),
      regex: z.boolean().default(false).describe('q 按正则（JavaScript 语法）'),
      limit: z.number().int().min(1).max(500).default(100),
    }),
    run: async (a, ctx) => {
      const pid = pidOf(a.projectId, ctx)
      const q = a.field ? `${a.field}:${a.q}` : a.q
      const flags = `${a.whole ? '&whole=1' : ''}${a.caseSensitive ? '&case=1' : ''}${a.regex ? '&regex=1' : ''}`
      const r = (await ctx.api(
        'GET',
        `${API}/tables/${enc(pid)}/search?q=${enc(q)}${flags}&limit=${a.limit}`,
      )) as TableSearch
      return {
        searched: r.files,
        ...(r.field ? { field: r.field } : {}),
        ...(r.fieldMissing ? { note: `没有哪张表有字段「${r.fieldMissing}」，按整串找了` } : {}),
        hits: r.hits.map((h) => ({
          path: h.path,
          sheet: h.sheet,
          cell: `${colLetters(h.col)}${h.row + 1}`,
          ...(h.field ? { field: h.field } : { header: true }),
          ...(h.key ? { key: h.key } : {}),
          text: h.text,
        })),
        ...(r.truncated ? { truncated: `只列出前 ${r.hits.length} 处，缩小范围（写字段名、开 whole）再找` } : {}),
      }
    },
  }),
  defineAction({
    name: 'table.schema',
    title: '看一张表的列结构',
    description:
      '列出一张配置表每一列的字段名、类型、是不是数组（分隔符）、枚举能填哪些值、引用哪张表的哪个字段、取值范围、正则、必填，' +
      '以及表头有几行、数据从第几行开始、主键字段。按项目的表格结构识别（和表格页、保存前检查同一份）。加行、改值之前先用它看该填什么。',
    level: 'read',
    useWhen: '改格子前确认这一列的类型、枚举、引用和取值范围，免得写进非法值',
    input: z.object({
      projectId: PID,
      path: z.string().trim().min(1).max(600).describe('表格的路径（table.list 列出来的）'),
      sheet: z.string().max(200).optional().describe('工作表名，不写是第一张'),
    }),
    run: async (a, ctx) => {
      const pid = pidOf(a.projectId, ctx)
      const { doc, sheet, schema } = await openSheet(pid, a.path, a.sheet, ctx)
      const ext = await extSheets(pid, workbookNeeds(schema, a.path, [sheet]), ctx)
      const desc = describeSheet(schema, a.path, sheet, (f) => (f === a.path ? doc.sheets : ext[f]))
      return { path: a.path, sheets: doc.sheets.map((s) => s.name), ...desc }
    },
  }),
  defineAction({
    name: 'table.edit',
    title: '改表格',
    description:
      '按主键（或 Excel 行号）改一张配置表的格子、在末尾加行、删行。只写这些格子，样式、公式、其它工作表原样保留，文件格式不变，写之前自动备份。' +
      '按项目的表格结构检查（类型、枚举、引用、范围、主键重复），有问题时不写并列出原因。改 xlsx 一律用它，不要用 openpyxl 之类整本重写。',
    level: 'write',
    useWhen: '用户明确要你直接改表格时',
    avoidWhen: '用户想先看差异再决定时用 table.propose',
    input: TableEditInput.extend({ projectId: PID }),
    run: async (a, ctx) => {
      const pid = pidOf(a.projectId, ctx)
      const { doc, sheet, schema, header } = await openSheet(pid, a.path, a.sheet, ctx)
      if (!a.set.length && !a.add.length && !a.remove.length) throw new ActionError('set、add、remove 至少写一项')
      const key = schema.style.key
      let plan
      try {
        plan = planEdit(sheet.rows, header, key, sheet.name, a)
      } catch (e) {
        throw new ActionError((e as Error).message)
      }
      if (!a.force) await mustPass(pid, a.path, doc, sheet.name, schema, plan, ctx)
      await ctx.api('POST', `${API}/tables/${enc(pid)}/save`, { path: a.path, mtime: doc.mtime, sheets: [plan.edit] })
      return {
        saved: a.path,
        sheet: sheet.name,
        cells: plan.touched.length,
        added: a.add.length,
        removed: plan.removed,
        note: '只改了这些格子，文件格式没变；改之前的文件备份在面板的数据目录（tables-backup）。',
      }
    },
  }),
  defineAction({
    name: 'table.propose',
    title: '提议改表格（给用户确认）',
    description:
      '和 table.edit 参数一样，但不写文件：按表格结构检查通过后，把改动交给用户在表格页里看差异、确认后再放进表格保存。' +
      '用户从表格页让你「照着描述加几行」「修检查出的问题」时用它，不要用 table.edit。note 用一两句话说明改了什么、依据是什么。同一张表再提会替换上一份。',
    level: 'read',
    useWhen: '改动要用户确认后再写、或用户没明确说直接改时',
    input: TableEditInput.extend({
      projectId: PID,
      note: z.string().max(2000).default('').describe('给用户看的说明：改了什么、为什么'),
    }),
    run: async (a, ctx) => {
      const pid = pidOf(a.projectId, ctx)
      const { doc, sheet, schema, header } = await openSheet(pid, a.path, a.sheet, ctx)
      if (!a.set.length && !a.add.length && !a.remove.length) throw new ActionError('set、add、remove 至少写一项')
      let plan
      try {
        plan = planEdit(sheet.rows, header, schema.style.key, sheet.name, a)
      } catch (e) {
        throw new ActionError((e as Error).message)
      }
      if (!a.force) await mustPass(pid, a.path, doc, sheet.name, schema, plan, ctx)
      await ctx.api('POST', `${API}/tables/${enc(pid)}/proposal`, {
        path: a.path,
        mtime: doc.mtime,
        edit: plan.edit,
        note: a.note,
        cells: plan.touched.length,
        added: a.add.length,
        removed: plan.removed,
      })
      return {
        proposed: a.path,
        sheet: sheet.name,
        cells: plan.touched.length,
        added: a.add.length,
        removed: plan.removed,
        note: '还没写进文件：用户在表格页看过差异、确认后才会放进表格。告诉用户去表格页看「AI 提的改动」。',
      }
    },
  }),
  defineAction({
    name: 'table.check',
    title: '检查全部表格',
    description:
      '按项目的表格结构把所有配置表查一遍（类型、枚举、引用、范围、主键重复），按文件和工作表列出前几处问题。',
    level: 'read',
    useWhen: '改完表格后核对有没有破坏类型、枚举、引用和主键',
    input: z.object({ projectId: PID }),
    run: async (a, ctx) => {
      const r = (await ctx.api('GET', `${API}/tables/${enc(pidOf(a.projectId, ctx))}/check`)) as TablesCheck
      return {
        files: r.files,
        failed: r.failed,
        problems: r.sheets.map((s) => ({
          path: s.path,
          sheet: s.sheet,
          count: s.count,
          first: s.first.slice(0, 10).map((p) => `第 ${p.r + 1} 行 ${p.field}：${p.msg}`),
        })),
      }
    },
  }),
  defineAction({
    name: 'table.enum_scan_peek',
    title: '看枚举页签的原样内容',
    description:
      '读一个表格文件某个页签的前几十行原样内容，每格带 Excel 列号（A1、B2……），不按项目表头处理。用来看枚举定义页签怎么写的。',
    level: 'read',
    useWhen: '总结枚举扫描规则时，看表格里的枚举页签（常常没有表头、枚举名只写在每组第一行）',
    avoidWhen: '看普通配置表的表头和写法用 table.sample；代码文件（.h / .lua）直接读文件',
    input: z.object({
      projectId: PID,
      path: z.string().describe('表格文件路径（table.list 里的写法）'),
      sheet: z.string().optional().describe('页签名；不写是第一个'),
      from: z.number().int().min(1).optional().describe('从第几行开始（Excel 行号），默认 1'),
      rows: z.number().int().min(1).max(200).optional().describe('看几行，默认 60'),
    }),
    run: async (a, ctx) => {
      const pid = pidOf(a.projectId, ctx)
      const doc = (await ctx.api('GET', `${API}/tables/${enc(pid)}/file?path=${enc(a.path)}`)) as TableDoc
      const s = a.sheet ? doc.sheets.find((x) => x.name === a.sheet) : doc.sheets[0]
      if (!s) throw new ActionError(`没有页签「${a.sheet}」。有：${doc.sheets.map((x) => x.name).join('、')}`)
      const start = (a.from ?? 1) - 1
      const rows = s.rows.slice(start, start + (a.rows ?? 60))
      return {
        sheets: doc.sheets.map((x) => x.name),
        sheet: s.name,
        totalRows: s.rows.length,
        rows: rows.map((r, i) => ({
          row: start + i + 1,
          cells: Object.fromEntries(r.flatMap((v, c) => (v ? [[colLetters(c), v]] : []))),
        })),
      }
    },
  }),
  defineAction({
    name: 'table.enum_scan_try',
    title: '试跑枚举扫描规则',
    description:
      '按一条枚举扫描规则（格式见对话开头的说明）在本机试扫一次，不保存：返回扫出的枚举名、示例枚举的成员和值、提醒和错误。',
    level: 'read',
    useWhen: '总结或调整枚举扫描规则时，每改一次参数就试跑一次，直到示例枚举的成员和值都对上',
    avoidWhen: '规则还没定时不要让用户保存；自定义命令（kind=command）这里不试跑，要用户在设置里自己跑',
    input: z.object({
      projectId: PID,
      rule: z.record(z.string(), z.unknown()).describe('规则：{ name, from: { kind, … }, rename, auto }'),
      example: z.string().optional().describe('示例里的一个枚举名：返回它的全部成员（最多 200 个）'),
    }),
    run: async (a, ctx) => {
      const pid = pidOf(a.projectId, ctx)
      const got = EnumScan.safeParse({ id: 'try', ...a.rule })
      if (!got.success)
        throw new ActionError(
          `规则格式不对：${got.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join('.')}：${i.message}`)
            .join('；')}`,
        )
      // 模型写的命令不在这里执行：要跑的话由用户在设置里自己试跑
      if (got.data.from.kind === 'command')
        throw new ActionError('kind=command 不在这里试跑；能用内置写法就用内置写法，确实不行就在说明里讲清楚，交给用户')
      const run = (await ctx.api('POST', `${API}/tables/${enc(pid)}/enum-scan/try`, got.data)) as ScanRun
      const names = Object.keys(run.enums)
      const ex = a.example ? run.enums[a.example] : undefined
      return {
        error: run.error,
        enums: names.length,
        names: names.slice(0, 80),
        sizes: Object.fromEntries(names.slice(0, 80).map((n) => [n, run.enums[n].length])),
        ...(a.example ? { example: ex ? ex.slice(0, 200) : `没扫出 ${a.example}` } : {}),
        warnings: run.warnings.slice(0, 20),
      }
    },
  }),
]
