import { request } from '@panel/web/src/lib/api'
import type { LuaGmBinding } from '../../../server/lua-gm/types.ts'
import { t } from '../../host.ts'

/**
 * GM 参数下拉的数据：经面板动作入口调表格插件的 table.list / table.query（插件之间不互相 import，设计稿 4.2）。
 * 项目有 5000+ 表：只读关联的那一张，按搜索词让表格插件筛，结果按「表 + 搜索词」缓存到页面刷新为止。
 * 表格插件没装、没启用时动作不存在，抛出的原因给界面，界面退回普通输入框
 */
const act = <T>(name: string, args: Record<string, unknown>) =>
  request<T>(`/actions/${name}`, { method: 'POST', body: JSON.stringify(args) }).catch((e: Error) => {
    // 面板的原话会列出全部动作名，很长；没装表格插件是常见情况，换成一句能照做的
    if (/没有这个动作|no such action/i.test(e.message))
      throw new Error(t('没装或没启用表格插件，先直接填；装好后这里会变成能搜的下拉'))
    throw e
  })

export interface TableRow {
  key: string
  label: string
  extra: string[]
}

const NAME_COLS = ['Name', 'name', 'DisplayName', 'ShowName', 'Title', '名称', '名字', '显示名']
const resolved = new Map<string, Promise<LuaGmBinding>>()
const rows = new Map<string, Promise<{ rows: TableRow[]; total: number; fields: string[] }>>()

/**
 * 扫描脚本给的提示（Item.Id）换成实际的关联：按表名找表格文件（文件名去掉扩展名和表名一样的优先），
 * 名字列取常见的几个列名里有的那个
 */
export function resolveHint(projectId: string, table: string, key: string): Promise<LuaGmBinding> {
  const k = `${projectId}|${table}|${key}`
  let p = resolved.get(k)
  if (!p) {
    p = (async () => {
      const list = await act<{ files: string[] }>('table.list', { projectId, name: table })
      const files = list.files.map((f) => f.replace(/（只读）$/, ''))
      const base = (f: string) => (f.split('/').pop() ?? '').replace(/\.[^.]+$/, '').toLowerCase()
      const file = files.find((f) => base(f) === table.toLowerCase()) ?? files[0]
      if (!file) throw new Error(t('表格目录里没有名字含「{table}」的表', { table }))
      const q = await act<{ fields: string[] }>('table.query', { projectId, path: file, limit: 1 })
      if (!q.fields.includes(key)) throw new Error(t('{file} 没有「{key}」列', { file, key }))
      const label = NAME_COLS.find((c) => q.fields.includes(c))
      return { table: file, key, ...(label ? { label } : {}) }
    })()
    resolved.set(k, p)
    // 失败的不缓存：用户装好表格插件、设好表格目录后再点开就能用
    p.catch(() => resolved.delete(k))
  }
  return p
}

/** 下拉里参与搜索、显示的列：主列、描述列、辅助描述列（去重） */
export const bindCols = (b: LuaGmBinding) => [...new Set([b.key, ...(b.label ? [b.label] : []), ...(b.extra ?? [])])]

/**
 * 按主列、描述列、辅助描述列搜：每列分别按「包含」查（表格插件的 where ~），合起来去重；不搜时列前 30 行。
 * 不用 text（任何一格包含）：表里别的列（备注、路径）命中会把真正要找的挤出前 30 行
 */
export function searchRows(projectId: string, b: LuaGmBinding, q: string) {
  const fields = bindCols(b)
  const k = `${projectId}|${b.table}|${b.sheet ?? ''}|${fields.join(',')}|${q}`
  let p = rows.get(k)
  if (!p) {
    p = (async () => {
      const one = (where?: Record<string, string>) =>
        act<{ total: number; fields: string[]; rows: { values: Record<string, string> }[] }>('table.query', {
          projectId,
          path: b.table,
          ...(b.sheet ? { sheet: b.sheet } : {}),
          fields,
          limit: 30,
          ...(where ? { where } : {}),
        })
      const word = q.trim()
      const parts = word ? await Promise.all(fields.map((f) => one({ [f]: `~${word}` }))) : [await one()]
      const seen = new Set<string>()
      const out: TableRow[] = []
      for (const part of parts)
        for (const r of part.rows) {
          const key = r.values[b.key] ?? ''
          if (!key || seen.has(key)) continue
          seen.add(key)
          out.push({
            key,
            label: b.label ? (r.values[b.label] ?? '') : '',
            extra: (b.extra ?? []).map((c) => r.values[c] ?? ''),
          })
        }
      // 主列完全相同的排最前（输入 1001 时 1001 在 10010 前面），其次是主列、描述列里含这几个字的
      const rank = (r: TableRow) => (r.key === word ? 0 : r.key.includes(word) ? 1 : r.label.includes(word) ? 2 : 3)
      if (word) out.sort((a, c) => rank(a) - rank(c))
      return {
        rows: out.slice(0, 30),
        total: word ? out.length : (parts[0]?.total ?? 0),
        fields: parts[0]?.fields ?? [],
      }
    })()
    rows.set(k, p)
    p.catch(() => rows.delete(k))
  }
  return p
}

/** 关联弹窗：按表名找表格（只看路径，表格插件不读内容，5000 张表也快） */
export async function listTables(projectId: string, q: string) {
  const r = await act<{ files: string[]; truncated?: string }>('table.list', {
    projectId,
    ...(q.trim() ? { name: q.trim() } : {}),
  })
  return { files: r.files.map((f) => f.replace(/（只读）$/, '')), truncated: !!r.truncated }
}

/** 关联弹窗：一张表的页签，和某个页签的列（表头按表格页里设的结构认） */
export async function tableShape(projectId: string, table: string, sheet?: string) {
  const s = await act<{ sheets: string[] }>('table.schema', { projectId, path: table, ...(sheet ? { sheet } : {}) })
  const q = await act<{ sheet: string; fields: string[]; key: string }>('table.query', {
    projectId,
    path: table,
    ...(sheet ? { sheet } : {}),
    limit: 1,
  })
  return { sheets: s.sheets, sheet: q.sheet, fields: q.fields, key: q.key }
}

/** 选中的值对应的名字（输入框里显示「1001 · 新手长剑」） */
export async function labelOf(projectId: string, b: LuaGmBinding, value: string) {
  if (!value || !b.label) return ''
  const r = await act<{ rows: { values: Record<string, string> }[] }>('table.query', {
    projectId,
    path: b.table,
    ...(b.sheet ? { sheet: b.sheet } : {}),
    fields: [b.key, b.label],
    where: { [b.key]: value },
    limit: 1,
  })
  return r.rows[0]?.values[b.label] ?? ''
}
