/**
 * 值整理成 UE 细节面板的样子：
 * - UE 文本格式的结构体 "(R=1,G=0.5,B=0,A=1)" 拆成对象（颜色、向量就能出色块、分量框）；
 * - FSlateColor {SpecifiedColor: {R,G,B,A}, ColorUseRule?} 在 UE 里就是一个色块，直接取里面的颜色
 */
export function normalizeValue(v: unknown): unknown {
  if (typeof v === 'string') {
    const m = /^\(\s*([A-Za-z_]\w*\s*=\s*-?[\d.eE+-]+\s*(?:,\s*[A-Za-z_]\w*\s*=\s*-?[\d.eE+-]+\s*)*)\)$/.exec(v.trim())
    if (!m) return v
    const out: Record<string, number> = {}
    for (const part of m[1].split(',')) {
      const [k, n] = part.split('=').map((x) => x.trim())
      out[k] = Number(n)
    }
    return Object.values(out).every(Number.isFinite) ? out : v
  }
  if (Array.isArray(v)) return v.map(normalizeValue)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const keys = Object.keys(o)
    if ('SpecifiedColor' in o && keys.every((k) => k === 'SpecifiedColor' || k === 'ColorUseRule'))
      return normalizeValue(o.SpecifiedColor)
    return Object.fromEntries(keys.map((k) => [k, normalizeValue(o[k])]))
  }
  return v
}
