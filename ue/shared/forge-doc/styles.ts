/**
 * AssetForge 配置的样式复用（设计稿 4.2「样式复用」）：顶层 `styles: { "NavButton": { "props": {…}, "slot": {…} } }`，
 * 节点写 `"style": "NavButton"` 或数组（后面的覆盖前面的），节点自己写的 props / slot 再覆盖样式里的。
 * 合并和 UEKit 的 ForgeStyles::MergeObjects 一致：对象逐层递归合并（节点只写 Padding.Left 时其余三边留样式的），
 * 数组和标量整体替换；字段名按导入的规则认（大小写不敏感、`b` 前缀可省：样式写 bIsVariable、节点写 IsVariable 是同一个），
 * 后写的那份的拼法留下。样式对所有 kind 生效，只认 props 和 slot。
 * 网页预览、标记视图读配置时用这里，保证和导入出来的资源一样；引用了没定义的样式记在 missing 里（UE 演练会报错）。
 */
type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** 和 UEKit ForgeJsonText::NormalizeKey 一样：去掉 `bX` 的 b，转小写 */
export function normalizeField(k: string) {
  return (k.length > 1 && k[0] === 'b' && k[1] >= 'A' && k[1] <= 'Z' ? k.slice(1) : k).toLowerCase()
}

/** 递归合并：对象逐层合，数组和标量后面的整体替换；同一个字段（normalizeField 相等）只留一份，用 over 的拼法 */
export function mergeObjects(base: Obj | undefined, over: Obj | undefined): Obj {
  const out: Obj = { ...base }
  for (const [k, v] of Object.entries(over ?? {})) {
    const n = normalizeField(k)
    const old = Object.keys(out).find((x) => normalizeField(x) === n)
    const prev = old === undefined ? undefined : out[old]
    if (old !== undefined) delete out[old]
    out[k] = isObj(prev) && isObj(v) ? mergeObjects(prev, v) : v
  }
  return out
}

/** 节点引用的样式名（字符串或数组），按写的顺序 */
export function styleNames(node: unknown): string[] {
  const s = isObj(node) ? node.style : undefined
  if (typeof s === 'string') return s ? [s] : []
  return Array.isArray(s) ? s.filter((x): x is string => typeof x === 'string' && !!x) : []
}

export interface StyledNode {
  props?: Obj
  slot?: Obj
  /** 属性来自哪个样式（规范化后的 props 键 → 样式名）；节点自己写了的不在里面 */
  propFrom: Record<string, string>
  slotFrom: Record<string, string>
  /** 引用了但 styles 里没有的样式名 */
  missing: string[]
}

/** 把样式套到一个节点上：返回合并后的 props / slot，以及每个属性来自哪个样式（预览里标出处用） */
export function applyStyles(node: unknown, styles: unknown): StyledNode {
  const n = isObj(node) ? node : {}
  const table = isObj(styles) ? styles : {}
  const out: StyledNode = { propFrom: {}, slotFrom: {}, missing: [] }
  let props: Obj | undefined
  let slot: Obj | undefined
  for (const name of styleNames(n)) {
    const st = table[name]
    if (!isObj(st)) {
      out.missing.push(name)
      continue
    }
    if (isObj(st.props)) {
      props = mergeObjects(props, st.props)
      for (const k of Object.keys(st.props)) out.propFrom[normalizeField(k)] = name
    }
    if (isObj(st.slot)) {
      slot = mergeObjects(slot, st.slot)
      for (const k of Object.keys(st.slot)) out.slotFrom[normalizeField(k)] = name
    }
  }
  // 节点自己写的整个字段算节点的（结构体里只改了一部分也算），出处按规范化的字段名记
  if (isObj(n.props)) {
    props = mergeObjects(props, n.props)
    for (const k of Object.keys(n.props)) delete out.propFrom[normalizeField(k)]
  }
  if (isObj(n.slot)) {
    slot = mergeObjects(slot, n.slot)
    for (const k of Object.keys(n.slot)) delete out.slotFrom[normalizeField(k)]
  }
  if (props) out.props = props
  if (slot) out.slot = slot
  return out
}

/**
 * 整棵节点树套样式：返回新树（不改原对象），每个节点的 props / slot 换成合并后的，`style` 字段留着（显示时还要看引用了谁）。
 * 没有 styles 也没有节点引用样式时原样返回，大配置不白拷一遍
 */
export function resolveStyles<T>(root: T, styles: unknown): T {
  if (!isObj(root)) return root
  const walk = (n: Obj): Obj => {
    const kids = Array.isArray(n.children) ? n.children : undefined
    const newKids = kids?.map((c) => (isObj(c) ? walk(c) : c))
    const named = styleNames(n).length > 0
    if (!named && (!kids || newKids!.every((c, i) => c === kids[i]))) return n
    const out: Obj = { ...n }
    if (named) {
      const s = applyStyles(n, styles)
      if (s.props) out.props = s.props
      if (s.slot) out.slot = s.slot
    }
    if (newKids) out.children = newKids
    return out
  }
  return walk(root) as T
}
