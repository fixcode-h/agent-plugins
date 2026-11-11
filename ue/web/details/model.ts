import { t } from '../host.ts'

/** 桥接 props 给的一条属性（桥接 1.5.0 起多了显示名、高级、内部、容器信息；旧桥接没有这些字段，网页自己推） */
export interface Prop {
  name: string
  type: string
  category?: string
  tooltip?: string
  replicated?: boolean
  readOnly?: boolean
  /** 不能改的原因（桥接给的：EditConst、内部状态、只能在默认值 / 实例上改…） */
  readOnlyWhy?: string
  enum?: string[]
  /** 枚举在细节面板上的显示名（Axis1D (float)），和 enum 一一对应 */
  enumLabels?: string[]
  value: unknown
  /** 细节面板上的名字（bTriggerWhenPaused → Trigger when Paused） */
  displayName?: string
  /** 细节面板里放进「高级」折叠区的属性（AdvancedDisplay） */
  advanced?: boolean
  /** 细节面板里出现的属性（有 EditAnywhere 这类标记）；false 是只有 C++ / 蓝图逻辑用的内部状态 */
  edit?: boolean
  container?: 'array' | 'set' | 'map'
  count?: number
  inner?: string
  fixedSize?: boolean
}

/**
 * 没有显示名时照 UE 的 FName::NameToDisplayString 推：布尔去掉开头的 b、驼峰拆词、下划线变空格。
 * 只是兜底（旧桥接、结构体成员），桥接给了 displayName 就用桥接的
 */
export function toDisplay(name: string, isBool = false) {
  let s = isBool && /^b[A-Z]/.test(name) ? name.slice(1) : name
  s = s
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  return s ? s[0].toUpperCase() + s.slice(1) : name
}

export const labelOf = (p: Prop) => p.displayName || toDisplay(p.name, p.type === 'bool')

/** 内部状态：桥接给了 edit 就用；旧桥接没有时，没有 Category 的就当内部（C++ 里 EditAnywhere 必须写 Category） */
export const isInternal = (p: Prop) => (p.edit === undefined ? !p.category : !p.edit)

/** 分类：UE 的 Category 用 | 分层（Appearance|Brush），第一层是折叠条，后面的是里面的小节 */
export function splitCategory(c: string | undefined) {
  const [top, ...rest] = (c || '').split('|').map((x) => x.trim())
  return { top: top || t('默认'), sub: rest.filter(Boolean) }
}

/** 分类折叠条里的一层（第二层以后的小节） */
export interface Group {
  key: string
  title: string
  props: Prop[]
  advanced: Prop[]
  subs: Group[]
}

/**
 * 按分类建树：分类顺序按第一次出现（桥接按类继承顺序列，和细节面板一样子类在前），
 * 每层再分「平常」和「高级」两拨；内部状态单独一组放最后（UE 细节面板不显示它们，排查时又常要看）
 */
export function buildGroups(props: Prop[]) {
  const roots: Group[] = []
  const internal: Prop[] = []
  const find = (list: Group[], key: string, title: string) => {
    let g = list.find((x) => x.key === key)
    if (!g) {
      g = { key, title, props: [], advanced: [], subs: [] }
      list.push(g)
    }
    return g
  }
  for (const p of props) {
    if (isInternal(p)) {
      internal.push(p)
      continue
    }
    const { top, sub } = splitCategory(p.category)
    let g = find(roots, top, top)
    let key = top
    for (const s of sub) {
      key = `${key}|${s}`
      g = find(g.subs, key, s)
    }
    ;(p.advanced ? g.advanced : g.props).push(p)
  }
  return { roots, internal }
}

/** 搜索：显示名、变量名、分类名里包含（不分大小写）；分类名命中时整个分类都留着 */
export function matches(p: Prop, q: string) {
  if (!q) return true
  const s = q.toLowerCase()
  return (
    labelOf(p).toLowerCase().includes(s) ||
    p.name.toLowerCase().includes(s) ||
    (p.category ?? '').toLowerCase().includes(s)
  )
}

export const isNumberType = (type: string) =>
  /^(int|float|double|uint|int64|uint8|int8|int16|uint16|uint32|uint64)\b/.test(type)

/** 对象引用（路径字符串）：/Game/…、/Script/…、关卡里的对象 */
export const looksLikePath = (s: string) => /^\/(Game|Script|Engine|Temp)\/|:PersistentLevel\./.test(s)

/** 和服务端 isRuntimePath 一样：关卡里的、PIE 的、临时包里的对象 */
export const isRuntimePath = (p: string) =>
  !p.startsWith('/') || /:PersistentLevel|UEDPIE_|^\/Temp\/|^\/Engine\/Transient/i.test(p)

/** 对象引用显示的名字：路径最后一段，去掉蓝图类的 _C 后缀 */
export function refName(p: string) {
  const last = p.split(/[.:/]/).pop() || p
  return last.replace(/^Default__/, '')
}

/** 本地记住的界面状态（分类收起、名字列宽）：只是方便，读写失败当没有 */
export function remember<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem(`ue:details:${key}`)
    return v ? (JSON.parse(v) as T) : def
  } catch {
    return def
  }
}
export function keep(key: string, v: unknown) {
  try {
    localStorage.setItem(`ue:details:${key}`, JSON.stringify(v))
  } catch {}
}
