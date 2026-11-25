import { isUnread, type RawProp } from '../../../shared/uasset/props.ts'
import type { UObj } from '../../../shared/uasset/objects.ts'
import { t } from '../../util.ts'

/** 和 UELink 的 Brief 一样：路径、名字、类 */
export const brief = (o: UObj) => ({ path: o.path, name: o.name, class: o.class })

/** 读不懂的值（读取器标成 _unread 的）换成一句说明，别把内部结构给网页和 Agent */
export function clean(v: unknown, depth = 0): unknown {
  if (isUnread(v)) return t('（没读出来：{why}，{n} 字节）', { why: v._unread, n: v.bytes })
  if (depth > 32 || !v || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) out[k] = clean(x, depth + 1)
  return out
}

/** 截短长值：和桥接的 maxChars 一样，超了给 JSON 文本的开头 */
function clip(v: unknown, max: number): unknown {
  if (max <= 0) return v
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  if (s === undefined || s.length <= max) return v
  return `${s.slice(0, max)}…`
}

/** 一条属性（照 UELink 的 PropInfo）：文件里只有改过的值，所以都标 edit（不当内部状态藏起来）、只读 */
export function propInfo(p: RawProp, maxChars: number, readOnlyWhy: string) {
  const value = clean(p.value)
  const container =
    p.node.name === 'ArrayProperty'
      ? 'array'
      : p.node.name === 'SetProperty'
        ? 'set'
        : p.node.name === 'MapProperty'
          ? 'map'
          : ''
  return {
    name: p.arrayIndex ? `${p.name}[${p.arrayIndex}]` : p.name,
    type: p.type,
    edit: true,
    readOnly: true,
    readOnlyWhy,
    ...(container
      ? {
          container,
          count: Array.isArray(value)
            ? value.length
            : value && typeof value === 'object'
              ? Object.keys(value).length
              : 0,
        }
      : {}),
    value: clip(value, maxChars),
  }
}

export const readOnlyWhy = () => t('编辑器没开，这是从文件读的：要改先打开编辑器')

export const num = (v: unknown, d: number) =>
  Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d
