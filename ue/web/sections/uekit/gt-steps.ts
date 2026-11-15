import { t } from '../../host.ts'

/**
 * GameTest 步骤给人看的写法（GameTest 1.1）：录制会在 click / drag / wheel / type / key / assert 上附一份 hint
 * （资源路径、类、可见文字、视口里的位置），说明「这是哪个控件」。回放不读它，面板拿它把步骤显示成一句人话，
 * 选择器退到次要位置。hint.ambiguous 是录制时选择器核对没过的原因（可能点不到同一个控件），页面上标黄。
 */
export interface GtHint {
  asset?: string
  class?: string
  text?: string
  /** 视口里的归一化矩形 [x, y, w, h] */
  rect?: number[]
  ambiguous?: string | boolean
}

export const hintOf = (def?: Record<string, unknown>): GtHint | undefined => {
  const h = def?.hint
  return h && typeof h === 'object' && !Array.isArray(h) ? (h as GtHint) : undefined
}

/** 资源路径 /Game/UI/WBP_Login（或 .WBP_Login_C）→ WBP_Login */
const assetName = (p?: string) => p?.split('/').pop()?.split('.').pop()?.replace(/_C$/, '')

/** 控件类 → 人话里的称呼；不认识的类原样显示（WBP 名、项目自己的类） */
function kindOf(cls?: string) {
  if (!cls) return ''
  const c = cls.replace(/^S(?=[A-Z])/, '').replace(/<.*$/, '')
  if (/^Button$|Btn/i.test(c)) return t('按钮')
  if (/CheckBox/i.test(c)) return t('复选框')
  if (/EditableText|TextBox/i.test(c)) return t('输入框')
  if (/ComboBox/i.test(c)) return t('下拉框')
  if (/Slider|SpinBox/i.test(c)) return t('滑条')
  if (/TableRow|ListView|TileView/i.test(c)) return t('列表项')
  if (/ScrollBox/i.test(c)) return t('滚动区')
  return cls
}

/** 按钮「确定」：称呼 + 文字；都没有时空串 */
function widgetText(h: GtHint) {
  const kind = kindOf(h.class)
  const text = h.text ? t('「{s}」', { s: h.text.length > 24 ? `${h.text.slice(0, 24)}…` : h.text }) : ''
  return `${kind}${text}`
}

/**
 * 有 hint 的 UI 步骤显示成一句人话，例如「点击 按钮「确定」 · WBP_Login」；没有 hint 的步骤返回 undefined，照旧显示选择器
 */
export function humanStep(def?: Record<string, unknown>): string | undefined {
  const h = hintOf(def)
  if (!def || !h) return undefined
  const what = widgetText(h) || t('控件')
  const where = assetName(h.asset)
  const str = (k: string) => (typeof def[k] === 'string' ? (def[k] as string) : '')
  let line: string
  switch (def.action) {
    case 'click':
      line = /^Right/.test(str('button'))
        ? t('右键点击 {w}', { w: what })
        : /^Middle/.test(str('button'))
          ? t('中键点击 {w}', { w: what })
          : t('点击 {w}', { w: what })
      break
    case 'drag':
      line = t('拖动 {w}', { w: what })
      break
    case 'wheel': {
      const d = Number(def.delta)
      line = t('在 {w} 上滚动 {d}', { w: what, d: Number.isFinite(d) ? `${d > 0 ? '↑' : '↓'}${Math.abs(d)}` : '' })
      break
    }
    case 'type':
      line = t('在 {w} 里输入「{s}」', { w: what, s: str('text') })
      break
    case 'key':
      line = t('在 {w} 上按 {k}', { w: what, k: str('key') })
      break
    case 'assert':
      line = t('检查 {w}', { w: what })
      break
    default:
      line = what
  }
  return where ? `${line} · ${where}` : line
}

/** hint.ambiguous 的说明：录制时选择器没能唯一指回这个控件 */
export function ambiguousOf(def?: Record<string, unknown>): string | undefined {
  const a = hintOf(def)?.ambiguous
  if (!a) return undefined
  return typeof a === 'string' && a ? a : t('录制时这个选择器没能唯一指回点的控件，回放可能点到别的')
}

/**
 * schemaVersion 1 的场景里 click / type 没写 via 时是旧的代码级操作（GameTest 读场景时补 via:"code"）。
 * 「从这一步开始运行」把步骤拆出来交给 gt.run，不经过场景文件的读入，所以由面板照样补上，行为不变
 */
export function legacySteps<T extends Record<string, unknown>>(steps: T[], schemaVersion?: number): T[] {
  if (!schemaVersion || schemaVersion >= 2) return steps
  return steps.map((s) => ((s.action === 'click' || s.action === 'type') && !('via' in s) ? { ...s, via: 'code' } : s))
}

const MOUSE = /^(Left|Right|Middle)MouseButton$/

/**
 * 旧录制里的坐标点击：`input.cursor {x,y}` 后面跟一次鼠标键——`key phase=tap`，或 `key phase=press`、中间只有 wait、
 * 再 `key phase=release`（同一个键）。返回这一段的范围和坐标，认不出来时 undefined
 */
export function coordClickAt(steps: Record<string, unknown>[], i: number) {
  const c = steps[i]
  if (c?.action !== 'input.cursor' || typeof c.x !== 'number' || typeof c.y !== 'number') return undefined
  const k = steps[i + 1]
  if (k?.action !== 'key' || typeof k.key !== 'string' || !MOUSE.test(k.key)) return undefined
  const phase = k.phase ?? 'tap'
  if (phase === 'tap') return { start: i, count: 2, x: c.x, y: c.y, button: k.key }
  if (phase !== 'press') return undefined
  for (let j = i + 2; j < steps.length; j++) {
    const s = steps[j]
    if (s.action === 'wait') continue
    if (s.action === 'key' && s.key === k.key && s.phase === 'release')
      return { start: i, count: j - i + 1, x: c.x, y: c.y, button: k.key }
    return undefined
  }
  return undefined
}

/** gt.inspect 的返回（只用到这几样） */
export interface GtInspect {
  supported?: boolean
  handlerSource?: string
  target?: string
  verified?: boolean
  hint?: GtHint
}

/**
 * 坐标点击 → 控件点击：选择器和 hint 用 gt.inspect 在这个坐标上认出来的；点的位置离控件中心远时（和录制器同一个阈值 0.2）
 * 按 hint.rect 算出控件内位置写进 at
 */
export function clickFromInspect(
  span: { x: number; y: number; button: string },
  r: GtInspect,
  keep: Record<string, unknown> = {},
) {
  const step: Record<string, unknown> = { action: 'click', target: r.target }
  const rect = r.hint?.rect
  if (rect && rect.length === 4 && rect[2] > 0 && rect[3] > 0) {
    const ax = (span.x - rect[0]) / rect[2]
    const ay = (span.y - rect[1]) / rect[3]
    if (Math.abs(ax - 0.5) > 0.2 || Math.abs(ay - 0.5) > 0.2)
      step.at = [Math.round(ax * 1000) / 1000, Math.round(ay * 1000) / 1000]
  }
  if (span.button !== 'LeftMouseButton') step.button = span.button
  if (typeof keep.note === 'string') step.note = keep.note
  if (r.hint) step.hint = r.verified === false && !r.hint.ambiguous ? { ...r.hint, ambiguous: true } : r.hint
  return step
}
