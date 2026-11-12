/**
 * xlsx 原地插删行列时要额外小心的部分（xlsx-write.ts 调用）：
 * - 哪些表不能在中间插删行列（拒绝规则，见 docs/README.md「插删行列的拒绝规则」）；
 * - 列操作时每格的列号、`<cols>` 里的列宽和样式区间怎么跟着挪。
 * 公式、合并单元格、数据验证这些东西里写的是「A1:C3」这样的位置，挪了行列它们不会自己跟着变，
 * 这里不去改写它们（改错了比拒绝更糟），而是直接拒绝，交给表格软件做。
 */
import { t } from '../../shared/i18n.ts'
import { cellRef, type ColOp } from '../../shared/table-edit.ts'
import { attr } from '../xlsx.ts'

/** 公式：<f>、<x:f> 这些 */
export const FORMULA = /<(\w+:)?f[\s>/]/

/** 别的部件（别的工作表的公式、图表的数据区、数据透视表的来源）有没有指到这张表 */
export function referencedElsewhere(sheetName: string, others: Iterable<string>) {
  // 公式里引用别的表写成 Sheet1!A1 或 'My Sheet'!A1（名字里的单引号写成两个）
  const plain = sheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const quoted = sheetName.replace(/'/g, "''").replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 名字前面不能紧挨着能出现在表名里的字（不然「道具」会误中「旧道具!A1」）
  const inFormula = new RegExp(`<(?:\\w+:)?f\\b[^>]*>[^<]*(?:'${quoted}'|(?<![\\p{L}\\p{N}_.])${plain})!`, 'u')
  const source = new RegExp(`<(?:\\w+:)?worksheetSource\\b[^>]*\\ssheet="${plain}"`)
  for (const xml of others) if (inFormula.test(xml) || source.test(xml)) return true
  return false
}

/**
 * 这张表能不能在中间插删行 / 列：返回不能的原因（空数组就是能）。
 * 只看「会因为挪位置而指错地方」的东西；样式、列宽、冻结窗格不在其列（行的样式跟着行走，列宽这里会一起挪）
 */
export function shiftBlocked(xml: string, book: string, sheetName: string, others: () => Iterable<string>) {
  const why: string[] = []
  if (FORMULA.test(xml)) why.push(t('公式'))
  if (/<mergeCell\b/.test(xml)) why.push(t('合并单元格'))
  // 新版 Excel 的数据验证、条件格式有的写在 extLst 里（x14:dataValidation），一起算
  if (/<(\w+:)?dataValidation\b/.test(xml)) why.push(t('数据验证'))
  if (/<(\w+:)?conditionalFormatting\b/.test(xml)) why.push(t('条件格式'))
  if (/<hyperlink\b/.test(xml)) why.push(t('超链接'))
  if (/<tablePart\b/.test(xml)) why.push(t('表格对象'))
  if (/<autoFilter\b/.test(xml)) why.push(t('自动筛选'))
  // 批注挂在格子位置上（legacyDrawing 指向批注的形状），图片、图表按行列锚定
  if (/<legacyDrawing\b/.test(xml)) why.push(t('批注'))
  if (/<drawing\b/.test(xml)) why.push(t('图片或图表'))
  if (/<definedName\b/.test(book)) why.push(t('名称定义'))
  if (referencedElsewhere(sheetName, others())) why.push(t('别的工作表或图表引用了这张表'))
  return why
}

/** 一格的 r 换成新的列（行号不变）；原来没写 r 的补上（同一行里前面的格子挪了，隐含的位置就不对了） */
export function setCellCol(raw: string, row: number, col: number) {
  const ref = cellRef(row, col)
  if (/^<c\b[^>]*?\sr="/.test(raw)) return raw.replace(/^(<c\b[^>]*?\sr=")[^"]*(")/, `$1${ref}$2`)
  return raw.replace(/^<c\b/, `<c r="${ref}"`)
}

/**
 * 一行的格子做列操作：删掉落在删除区里的，后面的往前挪；插入处后面的往后挪。
 * 返回新的格子；没变化时返回 null（这一行原样输出）
 */
export function shiftCells<T extends { col: number; raw: string }>(cells: T[], row: number, ops: ColOp[]): T[] | null {
  let changed = false
  const out: T[] = []
  for (const cell of cells) {
    let c = cell.col
    let gone = false
    for (const op of ops) {
      if (c < op.at) continue
      if (op.n > 0) c += op.n
      else if (c < op.at - op.n) {
        gone = true
        break
      } else c += op.n
    }
    if (gone) {
      changed = true
      continue
    }
    if (c > 16_383) throw new Error(t('插入列以后超过了 xlsx 最多 16384 列的上限'))
    if (c !== cell.col) changed = true
    out.push({ ...cell, col: c })
  }
  if (!changed) return null
  // 格子都显式写上列号：前面的删了以后，后面没写 r 的格子位置会变
  return out.map((cell) => ({ ...cell, raw: setCellCol(cell.raw, row, cell.col) }))
}

/** 表里实际用到的最后一列（从 0 数，空表 -1） */
export function lastCol(rows: { col: number }[][]) {
  let max = -1
  for (const cells of rows) for (const c of cells) if (c.col > max) max = c.col
  return max
}

/**
 * `<cols>` 里的列宽、隐藏、样式区间跟着列操作挪：插在一个区间中间时区间变宽（和 Excel 一样，新列沿用左边那列的样式），
 * 删掉的列从区间里去掉，整段删光的区间去掉，`<cols>` 空了就整个去掉（空的 <cols/> Excel 不认）
 */
export function shiftColDefs(head: string, ops: ColOp[]) {
  const m = /<cols>([\s\S]*?)<\/cols>/.exec(head)
  if (!m) return head
  let defs = [...m[1].matchAll(/<col\b[^>]*?\/>/g)].map((x) => ({
    raw: x[0],
    min: Number(attr(x[0], 'min')),
    max: Number(attr(x[0], 'max')),
  }))
  // 区间写法不认识（没写 min / max）：不动它，宁可列宽错位也不写坏
  if (!defs.length || defs.some((d) => !(d.min > 0 && d.max >= d.min))) return head
  for (const op of ops) {
    const C = op.at + 1
    if (op.n > 0) {
      for (const d of defs) {
        if (d.min >= C) {
          d.min += op.n
          d.max += op.n
        } else if (d.max >= C) d.max += op.n
      }
    } else {
      const k = -op.n
      const D = C + k - 1
      defs = defs.flatMap((d) => {
        if (d.max < C) return [d]
        if (d.min > D) return [{ ...d, min: d.min - k, max: d.max - k }]
        const min = d.min < C ? d.min : C
        const max = d.max > D ? d.max - k : C - 1
        return max >= min ? [{ ...d, min, max }] : []
      })
    }
  }
  const kept = defs
    .filter((d) => d.min <= 16_384)
    .map((d) => ({ ...d, max: Math.min(d.max, 16_384) }))
    .map((d) => d.raw.replace(/\smin="\d+"/, ` min="${d.min}"`).replace(/\smax="\d+"/, ` max="${d.max}"`))
  return head.replace(m[0], kept.length ? `<cols>${kept.join('')}</cols>` : '')
}

/** 工作簿里每张表的名字 → 部件路径以外的其它 XML（找跨表引用用）；懒取，只有要在中间插删时才读 */
export function otherParts(entries: string[], skip: Set<string>, read: (name: string) => string | null) {
  return function* () {
    for (const name of entries) {
      if (skip.has(name) || !name.startsWith('xl/') || !name.endsWith('.xml')) continue
      if (name === 'xl/sharedStrings.xml' || name === 'xl/styles.xml' || name.startsWith('xl/theme/')) continue
      const xml = read(name)
      if (xml) yield xml
    }
  }
}
