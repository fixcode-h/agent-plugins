import type { SheetData } from '@shared/files'

/**
 * 版本差异只画当前这张工作表：这一版要是改的是别的工作表、或者表格内容一点没变（只改了格式、
 * P4 默认 submitunchanged 把没改的文件也提交了一版），当前表就只显示「数据没变」，用户分不清是真没变还是坏了。
 * 这里按整个文件比一遍每张工作表的格子，给界面一句说明。
 * 本地改动那一边只有当前表（页面上的内容），比不了别的表，不调这里
 */
export interface RevNote {
  /** 内容变了的其他工作表（含新加、删掉的） */
  others: string[]
  /** 所有工作表的格子都和对比的那一版一模一样 */
  allSame: boolean
}

const same = (a: string[][] | undefined, b: string[][] | undefined) => {
  if (!a || !b) return a === b
  // 末尾的空行、空格子不算变化：不同版本的写出方式可能多留几格空的
  const trim = (rows: string[][]) => {
    const out = rows.map((r) => {
      let n = r.length
      while (n > 0 && !r[n - 1]) n--
      return r.slice(0, n)
    })
    while (out.length > 0 && !out[out.length - 1].length) out.pop()
    return out
  }
  const ta = trim(a)
  const tb = trim(b)
  return ta.length === tb.length && ta.every((r, i) => r.length === tb[i].length && r.every((v, c) => v === tb[i][c]))
}

export function revNote(a: SheetData[], b: SheetData[], current: string): RevNote {
  const names = [...new Set([...a.map((s) => s.name), ...b.map((s) => s.name)])]
  const rowsOf = (list: SheetData[], name: string) => list.find((s) => s.name === name)?.rows
  const changed = names.filter((n) => !same(rowsOf(a, n), rowsOf(b, n)))
  return { others: changed.filter((n) => n !== current), allSame: changed.length === 0 }
}
