import { t } from '../../../shared/i18n.ts'
import { brief, diffOf, list, literal, num, opt, raw, sheetRef, str } from './args.ts'
import type { OpDef } from './types.ts'

/** 电子表格、多维表格、云空间里的 Markdown 文件 */

const SHEET = { arg: 'sheet', kind: 'sheet' as const, accept: ['sheet'] }
const BASE = { arg: 'base', kind: 'bitable' as const, accept: ['bitable'] }
const MD = { arg: 'file', kind: 'file' as const, accept: ['file'] }

const where = (a: Record<string, unknown>) =>
  [str(a, 'sheet_name') || str(a, 'sheet_id'), str(a, 'range') || str(a, 'start_cell')].filter(Boolean).join(' ')

export const DATA_OPS: OpDef[] = [
  {
    tool: 'feishu_sheet',
    action: 'info',
    level: 'read',
    target: SHEET,
    label: () => t('读取表格结构'),
    output: 'json',
    cli: (_a, x) => ({ args: ['sheets', '+workbook-info', '--url', x!.url] }),
  },
  {
    tool: 'feishu_sheet',
    action: 'read',
    level: 'read',
    target: SHEET,
    label: () => t('读取表格内容'),
    output: 'doc',
    cli: (a, x) => {
      const out = ['sheets', '+csv-get', '--url', x!.url]
      sheetRef(out, a)
      opt(out, 'range', str(a, 'range'))
      return { args: out }
    },
  },
  {
    tool: 'feishu_sheet',
    action: 'find',
    level: 'read',
    target: SHEET,
    label: () => t('在表格里查找'),
    output: 'json',
    cli: (a, x) => {
      const out = ['sheets', '+cells-search', '--url', x!.url, '--find', str(a, 'find')]
      sheetRef(out, a)
      opt(out, 'range', str(a, 'range'))
      if (a.regex === true) out.push('--regex')
      return { args: out }
    },
  },
  {
    tool: 'feishu_sheet',
    action: 'write',
    level: 'write',
    target: SHEET,
    label: () => t('写入表格'),
    output: 'json',
    summary: (a) => t('位置：{where}', { where: where(a) || 'A1' }),
    diff: (a) => diffOf(t('表格'), '', raw(a, 'csv')),
    cli: (a, x) => {
      const out = ['sheets', '+csv-put', '--url', x!.url]
      sheetRef(out, a)
      opt(out, 'start-cell', str(a, 'start_cell') || 'A1')
      out.push('--csv', '-')
      return { args: out, stdin: raw(a, 'csv') }
    },
  },
  {
    tool: 'feishu_base',
    action: 'tables',
    level: 'read',
    target: BASE,
    label: () => t('读取多维表格的数据表'),
    output: 'json',
    cli: (_a, x) => ({ args: ['base', '+table-list', '--base-token', x!.token] }),
  },
  {
    tool: 'feishu_base',
    action: 'fields',
    level: 'read',
    target: BASE,
    label: () => t('读取多维表格的字段'),
    output: 'json',
    cli: (a, x) => ({ args: ['base', '+field-list', '--base-token', x!.token, '--table-id', str(a, 'table')] }),
  },
  {
    tool: 'feishu_base',
    action: 'records',
    level: 'read',
    target: BASE,
    label: () => t('读取多维表格的记录'),
    output: 'json',
    cli: (a, x) => {
      const out = ['base', '+record-list', '--base-token', x!.token, '--table-id', str(a, 'table')]
      for (const f of list(a, 'fields')) out.push('--field-id', f)
      opt(out, 'limit', num(a, 'limit') ?? 50)
      opt(out, 'offset', num(a, 'offset'))
      return { args: out }
    },
  },
  {
    tool: 'feishu_base',
    action: 'search',
    level: 'read',
    target: BASE,
    label: () => t('搜索多维表格的记录'),
    output: 'json',
    cli: (a, x) => {
      const out = ['base', '+record-search', '--base-token', x!.token, '--table-id', str(a, 'table')]
      opt(out, 'keyword', str(a, 'keyword'))
      for (const f of list(a, 'fields')) out.push('--search-field', f)
      opt(out, 'limit', num(a, 'limit'))
      return { args: out }
    },
  },
  {
    tool: 'feishu_base',
    action: 'get',
    level: 'read',
    target: BASE,
    label: () => t('读取多维表格的记录'),
    output: 'json',
    cli: (a, x) => {
      const out = ['base', '+record-get', '--base-token', x!.token, '--table-id', str(a, 'table')]
      for (const r of list(a, 'record_ids')) out.push('--record-id', r)
      return { args: out }
    },
  },
  {
    tool: 'feishu_base',
    action: 'upsert',
    level: 'write',
    target: BASE,
    label: () => t('写入多维表格的记录'),
    output: 'json',
    summary: (a) =>
      [
        t('数据表：{table}', { table: str(a, 'table') }),
        str(a, 'record_id') ? t('更新记录：{id}', { id: str(a, 'record_id') }) : t('新建一条记录'),
      ].join('\n'),
    diff: (a) => diffOf(t('记录'), '', JSON.stringify(a.record ?? {}, null, 2)),
    cli: (a, x) => {
      const out = ['base', '+record-upsert', '--base-token', x!.token, '--table-id', str(a, 'table')]
      opt(out, 'record-id', str(a, 'record_id'))
      out.push('--json', JSON.stringify(a.record ?? {}))
      return { args: out }
    },
  },
  {
    tool: 'feishu_markdown',
    action: 'fetch',
    level: 'read',
    target: MD,
    label: () => t('读取 Markdown 文件'),
    output: 'doc',
    cli: (_a, x) => ({ args: ['markdown', '+fetch', '--file-token', x!.token] }),
  },
  {
    tool: 'feishu_markdown',
    action: 'patch',
    level: 'write',
    target: MD,
    label: () => t('修改 Markdown 文件'),
    output: 'json',
    summary: (a) => (a.regex === true ? t('按正则替换') : t('按原文替换')),
    diff: (a) => diffOf('markdown', raw(a, 'pattern'), raw(a, 'content')),
    cli: (a, x) => {
      // pattern、content 都是输入类参数：content 走 stdin，pattern 转义 @
      const out = ['markdown', '+patch', '--file-token', x!.token, '--pattern', literal(raw(a, 'pattern'))]
      if (a.regex === true) out.push('--regex')
      out.push('--content', '-')
      return { args: out, stdin: raw(a, 'content') }
    },
  },
  {
    tool: 'feishu_markdown',
    action: 'overwrite',
    level: 'write',
    target: MD,
    label: () => t('覆盖 Markdown 文件'),
    output: 'json',
    summary: (a) => brief(raw(a, 'content')),
    diff: (a) => diffOf('markdown', '', raw(a, 'content')),
    cli: (a, x) => ({
      args: ['markdown', '+overwrite', '--file-token', x!.token, '--content', '-'],
      stdin: raw(a, 'content'),
    }),
  },
]
