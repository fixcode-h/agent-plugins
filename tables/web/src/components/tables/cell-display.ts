import { storeToShow } from '@shared/table-codec'
import type { ColInfo } from '@shared/table-struct'

/** 每列的显示缓存：存的字 → 显示的字。只存看得见的格子，满了清掉重算 */
const SHOWN = new WeakMap<object, Map<string, string>>() // 模块状态：缓存，丢了重算
const SHOWN_MAX = 5000

/**
 * 格子里显示的字（存的还是原值）：结构体、映射这类按显示样式（FVector 存 1#2#3、显示 (X=1,Y=2,Z=3)）；
 * 引用列显示成「1001 · 小明」。都不是就照原样，返回 undefined 让表格不调用
 */
export function cellDisplay(
  infoAt: (r: number, c: number) => ColInfo | undefined,
  hasTyped: boolean,
  refNameOf: Map<string, Map<string, string>> | null,
): ((r: number, c: number, text: string) => string) | undefined {
  if (!hasTyped && !refNameOf) return undefined
  return (r, c, text) => {
    const info = infoAt(r, c)
    if (!info) return text
    if (info.typed) {
      let m = SHOWN.get(info.typed)
      if (!m) SHOWN.set(info.typed, (m = new Map()))
      let s = m.get(text)
      if (s === undefined) {
        if (m.size > SHOWN_MAX) m.clear()
        s = storeToShow(info.typed.node, text, info.typed.codec)
        m.set(text, s)
      }
      return s
    }
    const names = info.ref ? refNameOf?.get(info.ref) : undefined
    if (!names?.size) return text
    const one = (v: string) => {
      const n = names.get(v.trim())
      return n ? `${v.trim()} · ${n}` : v
    }
    return info.list ? text.split(info.sep).map(one).join(`${info.sep} `) : one(text)
  }
}
