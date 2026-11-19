import type { WNode } from './model.ts'

/**
 * 近似预览的排版（设计稿 U4：UE 没开、桥接旧、资源还没导入时）：按控件树和 Slot / Padding / 对齐 / Size 属性，
 * 照 Slate 的规则粗算每个控件的矩形。只是「大概长这样」：字体按字数估宽，贴图、材质画不出来，富文本、换行都不精确。
 * 纯函数（单测在 umg.test.ts），画在 ApproxCanvas.tsx。
 */
export interface Rect {
  key: string
  x: number
  y: number
  w: number
  h: number
}

type Size = { w: number; h: number }
type Margin = { l: number; t: number; r: number; b: number }
type HA = 'Fill' | 'Left' | 'Center' | 'Right'
type VA = 'Fill' | 'Top' | 'Center' | 'Bottom'

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const obj = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

/** UE 文本格式的结构体 "(Left=1,Top=2)" 拆成对象；其他原样 */
export function structOf(v: unknown): Record<string, unknown> | undefined {
  if (typeof v === 'string') {
    const out: Record<string, unknown> = {}
    for (const m of v.matchAll(/(\w+)\s*=\s*(-?[\d.eE+-]+)/g)) out[m[1]] = Number(m[2])
    return Object.keys(out).length ? out : undefined
  }
  return obj(v)
}

/** Padding：一个数（四边一样）、{Left,Top,Right,Bottom}、"(Left=…)" 都认 */
export function marginOf(v: unknown, def: Margin = { l: 0, t: 0, r: 0, b: 0 }): Margin {
  if (typeof v === 'number') return { l: v, t: v, r: v, b: v }
  const o = structOf(v)
  if (!o) return def
  return { l: num(o.Left), t: num(o.Top), r: num(o.Right), b: num(o.Bottom) }
}

const halign = (v: unknown): HA | undefined => {
  const s = typeof v === 'string' ? v.replace(/^HAlign_/, '') : ''
  return (['Fill', 'Left', 'Center', 'Right'] as const).find((x) => x === s)
}
const valign = (v: unknown): VA | undefined => {
  const s = typeof v === 'string' ? v.replace(/^VAlign_/, '') : ''
  return (['Fill', 'Top', 'Center', 'Bottom'] as const).find((x) => x === s)
}

/** 插槽的 Size：{SizeRule: Fill|Auto, Value} 或 "Fill"；没写是 Auto（UE5 的盒子插槽默认 Automatic） */
export function sizeRule(slot?: Record<string, unknown>): { fill: boolean; value: number } {
  const s = slot?.Size
  if (typeof s === 'string') return { fill: /fill/i.test(s), value: 1 }
  const o = obj(s)
  if (!o) return { fill: false, value: 1 }
  return { fill: /fill/i.test(String(o.SizeRule ?? '')), value: num(o.Value, 1) }
}

const SINGLE =
  /^(Border|Button|SizeBox|ScaleBox|CheckBox|NamedSlot|SafeZone|RetainerBox|InvalidationBox|MenuAnchor|BackgroundBlur)$/
const HBOX = /^(HorizontalBox)$/
const VBOX = /^(VerticalBox|ScrollBox|ListView|TileView)$/

/** 文字估宽：中日韩字一个字号宽，其他 0.55 个 */
function textSize(text: string, size: number): Size {
  const lines = text.split('\n')
  let w = 0
  for (const l of lines) {
    let lw = 0
    for (const ch of l) lw += /[⺀-￿]/.test(ch) ? size : size * 0.55
    w = Math.max(w, lw)
  }
  return { w: Math.ceil(w), h: Math.ceil(size * 1.35 * Math.max(1, lines.length)) }
}

const fontSize = (p?: Record<string, unknown>) => num(obj(p?.Font)?.Size, 24)

/** 插槽里取边距、对齐（Border、Button 的内容对齐写在控件自己的属性上，子控件插槽没写时用它） */
function slotOf(child: WNode, parent: WNode) {
  const s = child.slot ?? {}
  const p = parent.props ?? {}
  const defH: HA = parent.cls === 'Button' ? 'Center' : /^(Overlay)$/.test(parent.cls) ? 'Left' : 'Fill'
  const defV: VA = parent.cls === 'Button' ? 'Center' : /^(Overlay)$/.test(parent.cls) ? 'Top' : 'Fill'
  return {
    pad: marginOf(s.Padding),
    h: halign(s.HorizontalAlignment) ?? halign(p.HorizontalAlignment) ?? defH,
    v: valign(s.VerticalAlignment) ?? valign(p.VerticalAlignment) ?? defV,
  }
}

/** 控件自己的内边距：Border、Button 的 Padding（UE 默认 Border 4,2；Button 12,1.5） */
function innerPad(n: WNode): Margin {
  const p = n.props ?? {}
  if (n.cls === 'Border') return marginOf(p.Padding, { l: 4, t: 2, r: 4, b: 2 })
  if (n.cls === 'Button') return marginOf(p.Padding, { l: 12, t: 1.5, r: 12, b: 1.5 })
  return { l: 0, t: 0, r: 0, b: 0 }
}

const activeIndex = (n: WNode) => num(n.active ?? n.props?.ActiveWidgetIndex, 0)
/** 参与排版的子控件：Collapsed 的不占位置；WidgetSwitcher 只排当前页 */
const visibleKids = (n: WNode) =>
  (n.cls === 'WidgetSwitcher' ? n.children.filter((_, i) => i === activeIndex(n)) : n.children).filter(
    (c) => c.visibility !== 'Collapsed',
  )

export function measure(n: WNode, memo = new Map<string, Size>()): Size {
  const hit = memo.get(n.key)
  if (hit) return hit
  const p = n.props ?? {}
  const kids = visibleKids(n).map((c) => {
    const d = measure(c, memo)
    const { pad } = slotOf(c, n)
    return { w: d.w + pad.l + pad.r, h: d.h + pad.t + pad.b }
  })
  const maxW = Math.max(0, ...kids.map((k) => k.w))
  const maxH = Math.max(0, ...kids.map((k) => k.h))
  let s: Size
  if (n.visibility === 'Collapsed') s = { w: 0, h: 0 }
  else if (/^(TextBlock|RichTextBlock|EditableText|EditableTextBox|MultiLineEditableText)$/.test(n.cls)) {
    const fs = fontSize(p)
    const t = textSize(String(p.Text ?? p.HintText ?? ''), fs)
    s = /Editable/.test(n.cls) ? { w: Math.max(t.w, 120), h: Math.max(t.h, fs * 1.6) } : t
  } else if (n.cls === 'Image') {
    const sz = structOf(obj(p.Brush)?.ImageSize)
    s = { w: num(sz?.X, 32), h: num(sz?.Y, 32) }
  } else if (n.cls === 'Spacer') {
    const sz = structOf(p.Size)
    s = { w: num(sz?.X, 1), h: num(sz?.Y, 1) }
  } else if (n.cls === 'ProgressBar' || n.cls === 'Slider') s = { w: 100, h: n.cls === 'Slider' ? 16 : 14 }
  else if (HBOX.test(n.cls)) s = { w: kids.reduce((a, k) => a + k.w, 0), h: maxH }
  else if (VBOX.test(n.cls)) s = { w: maxW, h: kids.reduce((a, k) => a + k.h, 0) }
  else if (!n.children.length && (n.user || n.cls === 'UserWidget')) s = { w: 160, h: 48 }
  else if (!n.children.length && n.cls === 'CheckBox') s = { w: 24, h: 24 }
  else {
    const pad = innerPad(n)
    s = { w: maxW + pad.l + pad.r, h: maxH + pad.t + pad.b }
  }
  if (n.cls === 'SizeBox') {
    const w = p.WidthOverride ?? p.bOverride_WidthOverride
    const hgt = p.HeightOverride ?? p.bOverride_HeightOverride
    if (typeof w === 'number' || p.bOverride_WidthOverride) s = { ...s, w: num(p.WidthOverride, s.w) }
    if (typeof hgt === 'number' || p.bOverride_HeightOverride) s = { ...s, h: num(p.HeightOverride, s.h) }
    s = { w: Math.max(s.w, num(p.MinDesiredWidth)), h: Math.max(s.h, num(p.MinDesiredHeight)) }
  }
  memo.set(n.key, s)
  return s
}

/** 在格子里按对齐放：Fill 占满，其他按期望大小靠边或居中 */
function align(cell: Omit<Rect, 'key'>, d: Size, h: HA, v: VA) {
  const w = h === 'Fill' ? cell.w : Math.min(d.w, cell.w)
  const hh = v === 'Fill' ? cell.h : Math.min(d.h, cell.h)
  const x = h === 'Right' ? cell.x + cell.w - w : h === 'Center' ? cell.x + (cell.w - w) / 2 : cell.x
  const y = v === 'Bottom' ? cell.y + cell.h - hh : v === 'Center' ? cell.y + (cell.h - hh) / 2 : cell.y
  return { x, y, w, h: hh }
}

const shrink = (r: Omit<Rect, 'key'>, m: Margin) => ({
  x: r.x + m.l,
  y: r.y + m.t,
  w: Math.max(0, r.w - m.l - m.r),
  h: Math.max(0, r.h - m.t - m.b),
})

/** 横排 / 竖排：Auto 的按期望大小，Fill 的按 Value 分剩下的（边距不算进分配） */
function stack(n: WNode, box: Omit<Rect, 'key'>, horiz: boolean, memo: Map<string, Size>, out: Rect[]) {
  const kids = visibleKids(n)
  const info = kids.map((c) => {
    const s = slotOf(c, n)
    const rule = n.cls === 'ScrollBox' ? { fill: false, value: 1 } : sizeRule(c.slot)
    return { c, ...s, rule, d: measure(c, memo) }
  })
  const along = (m: Margin) => (horiz ? m.l + m.r : m.t + m.b)
  const total = horiz ? box.w : box.h
  const fixed = info.reduce((a, i) => a + along(i.pad) + (i.rule.fill ? 0 : horiz ? i.d.w : i.d.h), 0)
  const fillSum = info.reduce((a, i) => a + (i.rule.fill ? i.rule.value : 0), 0)
  const free = Math.max(0, total - fixed)
  let at = horiz ? box.x : box.y
  for (const i of info) {
    const len = i.rule.fill ? (fillSum ? (free * i.rule.value) / fillSum : 0) : horiz ? i.d.w : i.d.h
    const cell = horiz
      ? { x: at, y: box.y, w: len + along(i.pad), h: box.h }
      : { x: box.x, y: at, w: box.w, h: len + along(i.pad) }
    at += horiz ? cell.w : cell.h
    arrange(i.c, align(shrink(cell, i.pad), i.d, i.h, i.v), memo, out)
  }
}

/** CanvasPanel 的插槽：锚点 + 偏移（锚点重合时 Right/Bottom 是宽高）+ 对齐 */
function canvasChild(c: WNode, box: Omit<Rect, 'key'>, memo: Map<string, Size>, out: Rect[]) {
  const s = c.slot ?? {}
  const ld = obj(s.LayoutData) ?? s
  const off = structOf(ld.Offsets) ?? {}
  const anc = obj(ld.Anchors) ?? {}
  const mn = structOf(anc.Minimum) ?? {}
  const mx = structOf(anc.Maximum) ?? mn
  const al = structOf(ld.Alignment) ?? {}
  const d = measure(c, memo)
  const auto = s.bAutoSize === true
  const ax0 = num(mn.X)
  const ay0 = num(mn.Y)
  const ax1 = num(mx.X, ax0)
  const ay1 = num(mx.Y, ay0)
  let x: number, y: number, w: number, h: number
  if (ax0 === ax1) {
    w = auto ? d.w : num(off.Right, d.w)
    x = box.x + ax0 * box.w + num(off.Left) - num(al.X) * w
  } else {
    x = box.x + ax0 * box.w + num(off.Left)
    w = box.x + ax1 * box.w - num(off.Right) - x
  }
  if (ay0 === ay1) {
    h = auto ? d.h : num(off.Bottom, d.h)
    y = box.y + ay0 * box.h + num(off.Top) - num(al.Y) * h
  } else {
    y = box.y + ay0 * box.h + num(off.Top)
    h = box.y + ay1 * box.h - num(off.Bottom) - y
  }
  arrange(c, { x, y, w: Math.max(0, w), h: Math.max(0, h) }, memo, out)
}

function arrange(n: WNode, box: Omit<Rect, 'key'>, memo: Map<string, Size>, out: Rect[]) {
  if (n.visibility === 'Collapsed') return
  out.push({ key: n.key, ...box })
  const kids = visibleKids(n)
  if (!kids.length) return
  if (HBOX.test(n.cls)) return stack(n, box, true, memo, out)
  if (VBOX.test(n.cls)) return stack(n, box, false, memo, out)
  if (n.cls === 'CanvasPanel') {
    for (const c of kids) canvasChild(c, box, memo, out)
    return
  }
  if (/^(UniformGridPanel|GridPanel)$/.test(n.cls)) {
    const rows = Math.max(1, ...kids.map((c) => num(c.slot?.Row) + 1))
    const cols = Math.max(1, ...kids.map((c) => num(c.slot?.Column) + 1))
    for (const c of kids) {
      const s = slotOf(c, n)
      const cell = {
        x: box.x + (num(c.slot?.Column) * box.w) / cols,
        y: box.y + (num(c.slot?.Row) * box.h) / rows,
        w: box.w / cols,
        h: box.h / rows,
      }
      arrange(c, align(shrink(cell, s.pad), measure(c, memo), s.h, s.v), memo, out)
    }
    return
  }
  // 单个子控件的容器（Border、Button、SizeBox…）和叠放的（Overlay、WidgetSwitcher）：每个子控件占整个内容区，按插槽对齐
  const inner = SINGLE.test(n.cls) ? shrink(box, innerPad(n)) : box
  for (const c of kids) {
    const s = slotOf(c, n)
    arrange(c, align(shrink(inner, s.pad), measure(c, memo), s.h, s.v), memo, out)
  }
}

/** 整棵树按屏幕尺寸排版，返回每个看得见的控件的矩形（父在前、子在后，和画的顺序一样） */
export function layoutTree(root: WNode, width: number, height: number): Rect[] {
  const out: Rect[] = []
  arrange(root, { x: 0, y: 0, w: width, h: height }, new Map(), out)
  return out
}

/** 点预览选控件：包含这个点的矩形里面积最小的（一样大时取后画的，也就是更深的那个） */
export function hitTest<R extends Omit<Rect, 'key'>>(rects: readonly R[], x: number, y: number): R | undefined {
  let best: R | undefined
  for (const r of rects) {
    if (x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h) continue
    if (!best || r.w * r.h <= best.w * best.h) best = r
  }
  return best
}

/** 动画里插槽边距的通道（slot.Padding.Left）要影响排版：把这一时刻的值写进节点的插槽再排 */
export function withSlotAnims(root: WNode, values: Map<string, Record<string, unknown>>): WNode {
  if (!values.size) return root
  const visit = (n: WNode): WNode => {
    const v = values.get(n.key) ?? values.get(n.name)
    let slot = n.slot
    if (v) {
      for (const [ch, val] of Object.entries(v)) {
        const m = /^slot\.Padding\.(Left|Top|Right|Bottom)$/i.exec(ch)
        if (!m || typeof val !== 'number') continue
        const pad = marginOf(slot?.Padding)
        const cur = { Left: pad.l, Top: pad.t, Right: pad.r, Bottom: pad.b }
        slot = { ...slot, Padding: { ...cur, [m[1]]: val } }
      }
    }
    const children = n.children.map(visit)
    return slot === n.slot && children.every((c, i) => c === n.children[i]) ? n : { ...n, slot, children }
  }
  return visit(root)
}
