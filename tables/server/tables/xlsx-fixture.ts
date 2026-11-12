/**
 * 测试用的 xlsx：照 Excel / WPS 存出来的样子拼（共享字符串、样式号、spans、公式、日期样式、
 * 第二张表、一张图片、带数据描述符的条目），用来验证原地改写只动该动的地方。只给测试用。
 */
import { buildZip } from './zip.ts'

const x = (s: string) => Buffer.from(s, 'utf8')

/** 一张游戏配置表（表头 3 行 + 数据 3 行）+ 一张带公式的统计表 + 一张图片 */
export function gameBook(opts: { formulaSheet1?: boolean; merge?: boolean } = {}) {
  const sst = ['optional', 'uint32', 'string', 'ID', 'Name', 'Kind', '木剑', '铁剑', 'Sword', 'Date']
  /** 共享字符串的序号就是它在 sst 里的位置 */
  const s = (i: number) => i
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:D6"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="12" customWidth="1"/></cols><sheetData><row r="1" spans="1:4"><c r="A1" s="1" t="s"><v>${s(0)}</v></c><c r="B1" s="1" t="s"><v>${s(0)}</v></c><c r="C1" s="1" t="s"><v>${s(0)}</v></c><c r="D1" s="1" t="s"><v>${s(0)}</v></c></row><row r="2" spans="1:4"><c r="A2" s="1" t="s"><v>${s(1)}</v></c><c r="B2" s="1" t="s"><v>${s(2)}</v></c><c r="C2" s="1" t="s"><v>${s(2)}</v></c><c r="D2" s="1" t="s"><v>${s(9)}</v></c></row><row r="3" spans="1:4"><c r="A3" s="2" t="s"><v>${s(3)}</v></c><c r="B3" s="2" t="s"><v>${s(4)}</v></c><c r="C3" s="2" t="s"><v>${s(5)}</v></c><c r="D3" s="2" t="s"><v>${s(9)}</v></c></row><row r="4" spans="1:4"><c r="A4" s="3"><v>1</v></c><c r="B4" s="3" t="s"><v>${s(6)}</v></c><c r="C4" s="3" t="s"><v>${s(8)}</v></c><c r="D4" s="4"><v>46023</v></c></row><row r="5" spans="1:4"><c r="A5" s="3"><v>2</v></c><c r="B5" s="3" t="s"><v>${s(7)}</v></c><c r="C5" s="3"/><c r="D5" s="4"><v>46024.5</v></c></row><row r="6" spans="1:4"><c r="A6" s="3"><v>3</v></c><c r="B6" s="3" t="s"><v>${s(6)}</v></c>${opts.formulaSheet1 ? '<c r="C6" s="3"><f>A6*2</f><v>6</v></c>' : ''}</row></sheetData>${opts.merge ? '<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>' : ''}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`
  const sheet2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1"><v>10</v></c><c r="B1"><f>A1*2</f><v>20</v></c></row><row r="2"><c r="A2"><v>5</v></c></row></sheetData></worksheet>`
  const sstXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="20" uniqueCount="${sst.length}">${sst.map((v) => `<si><t>${v}</t></si>`).join('')}</sst>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="176" formatCode="yyyy/m/d h:mm"/></numFmts><fonts count="1"><font><sz val="11"/></font></fonts><cellXfs count="5"><xf numFmtId="0" fontId="0"/><xf numFmtId="0" fontId="0" fillId="2"/><xf numFmtId="0" fontId="0" fillId="3"/><xf numFmtId="0" fontId="0"/><xf numFmtId="176" fontId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`
  const book = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="道具" sheetId="1" r:id="rId1"/><sheet name="统计" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029"/></workbook>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  return buildZip([
    { name: '[Content_Types].xml', data: x('<Types/>') },
    { name: 'xl/workbook.xml', data: x(book) },
    { name: 'xl/_rels/workbook.xml.rels', data: x(rels) },
    { name: 'xl/worksheets/sheet1.xml', data: x(sheet1), descriptor: true },
    { name: 'xl/worksheets/sheet2.xml', data: x(sheet2) },
    { name: 'xl/sharedStrings.xml', data: x(sstXml) },
    { name: 'xl/styles.xml', data: x(styles) },
    { name: 'xl/media/image1.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]), stored: true },
  ])
}

/**
 * 一本大 xlsx（性能基准用）：两行表头（类型、字段名）+ rows 行数据，每三列一列整数、其余是共享字符串，
 * 和策划常见的大物品表差不多（字符串多、几乎不重复）
 */
export function bigBook(rows: number, cols: number) {
  const sst: string[] = []
  // 列字母：A、B……AA（Excel 存的每个格子都带 r="B7" 这样的位置）
  const letters = Array.from({ length: cols }, (_, c) => {
    let s = ''
    for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
    return s
  })
  const str = (r: number, c: number, v: string) => `<c r="${letters[c]}${r}" t="s"><v>${sst.push(v) - 1}</v></c>`
  const lines: string[] = []
  const head = (r: number, f: (c: number) => string) => letters.map((_, c) => str(r, c, f(c))).join('')
  lines.push(`<row r="1">${head(1, (c) => (c % 3 ? 'string' : 'uint32'))}</row>`)
  lines.push(`<row r="2">${head(2, (c) => (c ? `F${c}` : 'ID'))}</row>`)
  for (let r = 0; r < rows; r++) {
    const at = r + 3
    let cells = ''
    for (let c = 0; c < cols; c++)
      cells += c % 3 ? str(at, c, `v${r}_${c}`) : `<c r="${letters[c]}${at}"><v>${r + c}</v></c>`
    lines.push(`<row r="${at}">${cells}</row>`)
  }
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lines.join('')}</sheetData></worksheet>`
  const sstXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sst.length}" uniqueCount="${sst.length}">${sst.map((v) => `<si><t>${v}</t></si>`).join('')}</sst>`
  const book = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Big" sheetId="1" r:id="rId1"/></sheets></workbook>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`
  return buildZip([
    { name: '[Content_Types].xml', data: x('<Types/>') },
    { name: 'xl/workbook.xml', data: x(book) },
    { name: 'xl/_rels/workbook.xml.rels', data: x(rels) },
    { name: 'xl/worksheets/sheet1.xml', data: x(sheet) },
    { name: 'xl/sharedStrings.xml', data: x(sstXml) },
  ])
}
