/**
 * 新建表格：在设置的表格目录里写一个新的 xlsx / CSV，内容是新建弹窗按项目表头配置拼好的表头行。
 * xlsx 从头拼一个最小的工作簿（共享字符串 + 一个工作表，表头冻结），Excel、WPS 都能直接打开，
 * 之后在表格页改格子走的还是原地改写那一套。已经有同名文件时拒绝，不覆盖。
 */
import path from 'node:path'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { t } from '../../shared/i18n.ts'
import { writeCsv } from '../../shared/csv.ts'
import type { TableCreate } from '../../shared/table-create.ts'
import type { TablesConfig } from '../../shared/tables.ts'
import { forgetLists, safeRel, tableRoot } from './files.ts'
import { HttpError } from './http-error.ts'
import { buildZip } from './zip.ts'

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 1.0 不允许的控制字符：Excel 也存不了，去掉
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

/** 列号转字母：0 → A，26 → AA */
function colName(c: number) {
  let s = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** 最小的 xlsx：所有格子都是文字（共享字符串），前 freeze 行冻结 */
export function newXlsx(sheet: string, rows: string[][], freeze: number): Buffer {
  const sst: string[] = []
  const index = new Map<string, number>()
  const sid = (v: string) => {
    let i = index.get(v)
    if (i === undefined) {
      i = sst.length
      sst.push(v)
      index.set(v, i)
    }
    return i
  }
  const width = Math.max(1, ...rows.map((r) => r.length))
  const body = rows
    .map((r, ri) => {
      const cells = r.map((v, ci) => (v ? `<c r="${colName(ci)}${ri + 1}" t="s"><v>${sid(v)}</v></c>` : '')).join('')
      return cells ? `<row r="${ri + 1}">${cells}</row>` : ''
    })
    .join('')
  const pane =
    freeze > 0
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : ''
  const ws = `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${REL}"><dimension ref="A1:${colName(width - 1)}${Math.max(1, rows.length)}"/>${pane}<sheetData>${body}</sheetData></worksheet>`
  const sharedStrings = `${XML}<sst xmlns="${MAIN}" count="${sst.length}" uniqueCount="${sst.length}">${sst
    .map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`)
    .join('')}</sst>`
  const styles = `${XML}<styleSheet xmlns="${MAIN}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`
  const x = (s: string) => Buffer.from(s, 'utf8')
  return buildZip([
    {
      name: '[Content_Types].xml',
      data: x(
        `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      data: x(
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: x(
        `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="${esc(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: x(
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
      ),
    },
    { name: 'xl/worksheets/sheet1.xml', data: x(ws) },
    { name: 'xl/sharedStrings.xml', data: x(sharedStrings) },
    { name: 'xl/styles.xml', data: x(styles) },
  ])
}

const exists = (full: string) =>
  stat(full)
    .then(() => true)
    .catch(() => false)

/** 写新表格：只能写在设置的表格目录里，不能覆盖已有的文件，表格页只读时不让建 */
export async function createTable(dir: string, cfg: TablesConfig, body: TableCreate): Promise<{ path: string }> {
  if (cfg.readOnly) throw new HttpError(t('表格设成了只读，不能新建'))
  const { rel, full } = safeRel(dir, body.path, cfg)
  const ext = path.extname(full).slice(1).toLowerCase()
  if (!['xlsx', 'csv', 'tsv'].includes(ext)) throw new HttpError(t('文件名要以 .xlsx、.csv 或 .tsv 结尾'))
  const roots = cfg.dirs.map((d) => tableRoot(dir, d).full)
  const inRoot = roots.some((r) => {
    const back = path.relative(r, full)
    return !!back && !back.startsWith('..') && !path.isAbsolute(back)
  })
  if (!inRoot) throw new HttpError(t('新表格要放在设置的表格目录里'))
  if (await exists(full)) throw new HttpError(t('已经有这个文件了'), 409)
  await mkdir(path.dirname(full), { recursive: true })
  const data =
    ext === 'xlsx'
      ? newXlsx(body.sheet, body.rows, body.freeze)
      : // 新 CSV 带 BOM、CRLF：Excel 直接双击打开中文不乱码
        writeCsv(body.rows, { delimiter: ext === 'tsv' ? '\t' : ',', eol: 'crlf', bom: true })
  // wx：写的一瞬间有人建了同名文件也不覆盖
  await writeFile(full, data, { flag: 'wx' })
  forgetLists()
  return { path: rel }
}
