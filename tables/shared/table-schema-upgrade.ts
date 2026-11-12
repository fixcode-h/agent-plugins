/**
 * 结构文件的旧格式换成新格式（2026-11-12 表头改成「行」的数组）。
 *
 * 为什么不是面板数据目录那种一次性迁移：结构文件默认在项目目录 .agentpanel/tables/ 里，跟着项目提交给团队，
 * 同事用旧版本面板写的、从版本控制里拉下来的旧格式文件随时会再出现，所以在读文件的入口统一换一次（只在
 * schema-store 的 readSchema 里调，不进 zod 定义）；下次保存就写成新格式。
 *
 * 旧格式：
 * - style.header / style.headers：一套或几套 { start, roles[], labels[] }，几套时按内容挑最合的；都没有 = 每张表自动识别
 * - style.roleEnums：按行的种类定能填什么（{ modifier: 'Modifier' }）
 * - style.exceptions[].header：同样是 { start, roles, labels }
 * - files.json：单张表的表头覆盖，键是「相对路径#工作表」
 * 新格式见 table-header.ts：一份项目表头 + 按文件指定（可以细到工作表）。
 */
import { SHEET_ROLES } from './sheet-header.ts'

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v)
const isOld = (h: unknown): h is Raw & { roles: unknown[] } => isObj(h) && Array.isArray(h.roles) && !('rows' in h)

/** 一份旧表头换成新的：不认识的角色当「其它」，原来的词留作这行的名字；能填什么按这种行原来的设置 */
export function upgradeRule(h: unknown, roleEnums: Raw = {}): unknown {
  if (!isOld(h)) return h
  const labels = Array.isArray(h.labels) ? h.labels : []
  return {
    start: h.start,
    rows: h.roles.map((r, i) => {
      const known = typeof r === 'string' && (SHEET_ROLES as readonly string[]).includes(r)
      const kind = known ? r : 'other'
      const label = typeof labels[i] === 'string' && labels[i] ? labels[i] : !known && typeof r === 'string' ? r : ''
      const values = roleEnums[kind]
      return {
        kind,
        ...(label ? { label: String(label).slice(0, 20) } : {}),
        ...(typeof values === 'string' && values ? { values } : {}),
      }
    }),
  }
}

/** 「相对路径#工作表」拆开：路径里也可能有 #，按表格文件的扩展名切 */
function splitFileKey(key: string): { file: string; sheet: string } {
  const m = /^(.*?\.(?:xlsx|xlsm|xls|et|csv|tsv))#(.*)$/i.exec(key)
  if (m) return { file: m[1], sheet: m[2] }
  const i = key.lastIndexOf('#')
  return i < 0 ? { file: key, sheet: '' } : { file: key.slice(0, i), sheet: key.slice(i + 1) }
}

/**
 * 读出来的原始 JSON（style / files 两部分）换成新格式；已经是新格式的原样返回。
 * - 几套表头：第一套当项目表头，其余几套变成 glob 为空的「按文件指定」，用户填上通配才生效，不丢
 * - 单张表的覆盖：变成只管那个工作表的「按文件指定」，排在最前面（原来它优先于例外规则）
 */
export function upgradeSchemaRaw(raw: Raw): Raw {
  const style = isObj(raw.style) ? { ...raw.style } : undefined
  const files = isObj(raw.files) ? raw.files : undefined
  const legacy =
    !!style && ('headers' in style || 'roleEnums' in style || isOld(style.header) || hasOldExceptions(style.exceptions))
  if (!legacy && !(files && Object.keys(files).length)) return raw
  const s: Raw = style ?? {}
  const roleEnums = isObj(s.roleEnums) ? s.roleEnums : {}
  // 旧版保存时 header 写的就是 headers 的第一套；没有 headers 时就只有这一套
  const all = Array.isArray(s.headers) && s.headers.length ? s.headers : isOld(s.header) ? [s.header] : []
  const [first, ...rest] = all.map((h) => upgradeRule(h, roleEnums))
  const own = Object.entries(files ?? {}).map(([key, h]) => {
    const { file, sheet } = splitFileKey(key)
    return { glob: file, ...(sheet ? { sheet } : {}), header: upgradeRule(h, roleEnums) }
  })
  const oldEx = Array.isArray(s.exceptions) ? s.exceptions : []
  const exceptions = [
    ...own,
    ...oldEx.map((e) => (isObj(e) ? { ...e, header: upgradeRule(e.header, roleEnums) } : e)),
    ...rest.map((header) => ({ glob: '', header })),
  ]
  delete s.headers
  delete s.roleEnums
  const header = first ?? (isOld(s.header) ? undefined : s.header)
  const next: Raw = { ...s, exceptions }
  if (header) next.header = header
  else delete next.header
  return { ...raw, style: next, files: {} }
}

function hasOldExceptions(v: unknown) {
  return Array.isArray(v) && v.some((e) => isObj(e) && isOld(e.header))
}
