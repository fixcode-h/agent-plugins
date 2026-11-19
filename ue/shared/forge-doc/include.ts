import { parseLocated, pathKey, type Located, type PathSeg } from './locate.ts'
import { sectionIds } from './sections.ts'

/**
 * AssetForge 配置的 include（设计稿 4.3.4）：一个资源还是一个主文件，某一段或某个节点可以引用片段文件，读的时候原样展开
 * （还是同一个资产，和生成子界面的 `ref` 不同）。
 * - 段 include：顶层 `"animations": { "include": "WBP_Shop.parts/animations.json" }`，片段文件 `{ "fragment": "animations", "animations": … }`。
 * - 节点 include：children 里的 `{ "include": "…" }`，片段文件 `{ "fragment": "node", "node": 节点或节点数组 }`，数组就展开成一组兄弟节点。
 * - 片段顶层有 fragment、没有 kind；资源配置有 kind。路径相对引用它的文件，不能出配置根；片段能再 include，成环报错；
 *   同一个片段被引用两次给警告（复用请用 ref 子界面或 styles）。
 * 规矩和 UEKit 读取层一致：头字段不能 include；include 对象里只能有 include 和 //；片段文件只能有 fragment、同名内容字段、
 * // 和 $schema；段片段的内容可以再 include 同一段的片段；只有 children 里的节点能 include。
 * 展开结果给网页预览、标记视图，也给 ue_forge 的 section 读；出错时 include 原样留在文档里，错误另列，页面照样能画。
 * 读文件由调用方给（网页走 ext/forge/read，服务端直接读盘），这里不碰文件系统。
 */
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** 最多展开这么多个片段：防止写错的配置把页面拖死 */
const MAX_FILES = 200

export interface IncludeOrigin {
  /** 片段文件（相对配置根） */
  file: string
  /** 写 include 的那份文件（相对配置根） */
  from: string
  /** 展开后在文档里的位置：段 include 是 [段名]，节点 include 是第一个展开出来的节点 */
  at: PathSeg[]
  kind: 'section' | 'node'
  /** 节点 include 展开成几个节点 */
  count: number
}

export interface Expanded {
  doc: unknown
  /** 读到的每份文件的解析结果（含行号），键是相对配置根的路径；主文件也在里面 */
  files: Map<string, Located>
  origins: IncludeOrigin[]
  /** 展开后的位置 → 原文所在（文件 + 文件里的路径），只记段和 children 的每一项；查用 sourceOf */
  sources: Map<string, { file: string; path: PathSeg[] }>
  errors: string[]
  warnings: string[]
}

/** 是不是 include 占位：只有 include（可以带 "//" 说明） */
export function includeStub(v: unknown): string | undefined {
  if (!isObj(v) || typeof v.include !== 'string' || !v.include) return undefined
  return Object.keys(v).every((k) => k === 'include' || k === '//') ? v.include : undefined
}

/** 相对 from 所在目录解析 include 路径（都是相对配置根的 / 路径）；出了配置根回 undefined */
export function resolveInclude(from: string, rel: string): string | undefined {
  const raw = rel.replace(/\\/g, '/')
  if (raw.startsWith('/') || /^[a-z]:/i.test(raw)) return undefined
  const parts = from.replace(/\\/g, '/').split('/').slice(0, -1)
  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (!parts.length) return undefined
      parts.pop()
    } else parts.push(seg)
  }
  return parts.join('/')
}

const SECTION_NAME: Record<string, string> = { animations: '动画', styles: '样式', root: '控件树', node: '节点' }
const said = (f: string) => SECTION_NAME[f] ?? f

/** 片段文件顶层能有的字段（除了和 fragment 同名的内容字段） */
const FRAGMENT_FIELDS = new Set(['fragment', '//', '$schema'])

/**
 * 展开一份配置的全部 include；main 是相对配置根的路径，read 读不到回 undefined。
 * ids 是这种 kind 的段表（不给按配置的 kind 查内置表）：段 include 只认段表里的段
 */
export async function expandConfig(
  main: string,
  read: (rel: string) => Promise<string | undefined>,
  ids?: readonly string[],
): Promise<Expanded> {
  const out: Expanded = { doc: undefined, files: new Map(), origins: [], sources: new Map(), errors: [], warnings: [] }
  const uses = new Map<string, number>()

  const load = async (file: string): Promise<Located | undefined> => {
    const hit = out.files.get(file)
    if (hit) return hit
    if (out.files.size >= MAX_FILES) {
      out.errors.push(`include 太多（超过 ${MAX_FILES} 个片段），后面的没展开`)
      return undefined
    }
    const text = await read(file).catch(() => undefined)
    if (text === undefined) return undefined
    try {
      const loc = parseLocated(text)
      out.files.set(file, loc)
      return loc
    } catch (e) {
      out.errors.push(`${file}：${(e as Error).message}`)
      return undefined
    }
  }

  /** 读一个片段并核对它能放在 want（node 或段名）这个位置；不行回 undefined、记错误 */
  const fragment = async (from: string, rel: string, want: string, stack: string[]) => {
    const file = resolveInclude(from, rel)
    if (!file || !/\.json$/i.test(file)) {
      out.errors.push(`${from}：include "${rel}" 要是配置根里的 .json 文件`)
      return undefined
    }
    if (stack.includes(file)) {
      out.errors.push(`include 成环：${[...stack, file].join(' → ')}`)
      return undefined
    }
    const loc = await load(file)
    if (!loc) {
      if (!out.errors.some((e) => e.startsWith(`${file}：`)))
        out.errors.push(`${from}：include 的片段 ${file} 不存在或读不了`)
      return undefined
    }
    const f = isObj(loc.value) ? loc.value : {}
    if (typeof f.kind === 'string') {
      out.errors.push(`${file} 是资源配置（有 kind），不是片段，不能 include；要嵌另一个界面用 ref`)
      return undefined
    }
    if (typeof f.fragment !== 'string') {
      out.errors.push(`${file} 不是片段文件：顶层要写 "fragment": "${want}"`)
      return undefined
    }
    if (f.fragment !== want) {
      out.errors.push(
        want === 'node'
          ? `${file} 是${said(f.fragment)}片段，不能 include 到控件树里（节点位置要 "fragment": "node"）`
          : `${file} 是${said(f.fragment)}片段，不能当 ${want} 段（要 "fragment": "${want}"）`,
      )
      return undefined
    }
    if (!(want in f)) {
      out.errors.push(`${file} 缺少 ${want} 字段（片段的内容放在和 fragment 同名的字段里）`)
      return undefined
    }
    const extra = Object.keys(f).filter((k) => k !== want && !FRAGMENT_FIELDS.has(k))
    if (extra.length) {
      out.errors.push(`${file} 里不能有 ${extra.join('、')}：片段文件只写 fragment、${want}（和 // 说明）`)
      return undefined
    }
    const n = (uses.get(file) ?? 0) + 1
    uses.set(file, n)
    if (n === 2) out.warnings.push(`${file} 被引用了不止一次：片段只给一个资源用，复用请用 ref 子界面或 styles`)
    return { file, value: f[want] }
  }

  /** 展开一个节点的 children 里的 include；file/src 是这个节点原文所在 */
  const node = async (n: unknown, file: string, src: PathSeg[], at: PathSeg[], stack: string[]): Promise<unknown> => {
    if (!isObj(n) || !Array.isArray(n.children)) return n
    const kids: unknown[] = []
    for (let i = 0; i < n.children.length; i++) {
      const c = n.children[i]
      const inc = includeStub(c)
      const here = (): PathSeg[] => [...at, 'children', kids.length]
      if (inc) {
        const f = await fragment(file, inc, 'node', [...stack, file])
        if (f) {
          const list = Array.isArray(f.value) ? f.value : [f.value]
          out.origins.push({ file: f.file, from: file, at: here(), kind: 'node', count: list.length })
          for (let j = 0; j < list.length; j++) {
            const p = here()
            const fs: PathSeg[] = Array.isArray(f.value) ? ['node', j] : ['node']
            out.sources.set(pathKey(p), { file: f.file, path: fs })
            kids.push(await node(list[j], f.file, fs, p, [...stack, file]))
          }
          continue
        }
      }
      const p = here()
      out.sources.set(pathKey(p), { file, path: [...src, 'children', i] })
      kids.push(await node(c, file, [...src, 'children', i], p, stack))
    }
    return { ...n, children: kids }
  }

  const mainLoc = await load(main)
  if (!mainLoc) {
    if (!out.errors.length) out.errors.push(`读不了 ${main}`)
    return out
  }
  if (!isObj(mainLoc.value)) {
    out.doc = mainLoc.value
    return out
  }
  if (typeof mainLoc.value.fragment === 'string' && typeof mainLoc.value.kind !== 'string')
    out.warnings.push(`${main} 是片段文件，不是一份资源配置：按 include 它的那份配置看`)
  const doc: Obj = {}
  const sections = ids ?? sectionIds(undefined, mainLoc.value.kind)
  for (const [k, v] of Object.entries(mainLoc.value)) {
    let file = main
    const src: PathSeg[] = [k]
    let val = v
    const inc = k === '//' ? undefined : includeStub(v)
    if (inc && !sections.includes(k))
      out.errors.push(`${main}：头字段 ${k} 不能 include，只有段（${sections.join('、')}）能放到片段文件`)
    else if (inc) {
      // 段片段的内容还可以再 include 同一段的片段：一直跟到真正的内容，来源记最后那份
      const stack = [main]
      let next: string | undefined = inc
      while (next) {
        const f = await fragment(file, next, k, stack)
        if (!f) break
        stack.push(f.file)
        file = f.file
        val = f.value
        next = includeStub(f.value)
      }
      if (file !== main) out.origins.push({ file, from: stack.at(-2) ?? main, at: [k], kind: 'section', count: 1 })
    }
    out.sources.set(pathKey([k]), { file, path: src })
    doc[k] = k === 'root' ? await node(val, file, src, ['root'], file === main ? [] : [main]) : val
  }
  out.doc = doc
  return out
}

/** 展开后的一个位置在哪份文件、文件里的哪个路径（找最长的已记前缀，剩下的段照接） */
export function sourceOf(exp: Pick<Expanded, 'sources'>, path: readonly PathSeg[], main: string) {
  for (let n = path.length; n > 0; n--) {
    const hit = exp.sources.get(pathKey(path.slice(0, n)))
    if (hit) return { file: hit.file, path: [...hit.path, ...path.slice(n)] }
  }
  return { file: main, path: [...path] }
}

/** 这个位置是不是从片段展开出来的：回最近的那个 include（节点 include 覆盖它展开出的每个节点） */
export function originAt(exp: Pick<Expanded, 'origins'>, path: readonly PathSeg[]): IncludeOrigin | undefined {
  let best: IncludeOrigin | undefined
  for (const o of exp.origins) {
    const at = o.at
    let hit = false
    if (o.kind === 'section') hit = path.length >= 1 && path[0] === at[0]
    else {
      const parent = at.slice(0, -1)
      const first = at[at.length - 1] as number
      const idx = path[parent.length]
      hit =
        path.length >= at.length &&
        parent.every((s, i) => path[i] === s) &&
        typeof idx === 'number' &&
        idx >= first &&
        idx < first + o.count
    }
    if (hit && (!best || at.length > best.at.length)) best = o
  }
  return best
}
