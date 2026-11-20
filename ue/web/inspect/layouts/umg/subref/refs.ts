import { resolveInclude } from '../../../../../shared/forge-doc/include.ts'
import { resolveStyles } from '../../../../../shared/forge-doc/styles.ts'
import { t } from '../../../../host.ts'
import { fromConfig, type CfgNode, type UmgConfig } from '../config.ts'
import type { WNode } from '../model.ts'

/**
 * 子界面（AssetForge 的 `ref`）在设计器里怎么画（用户 2026-11-20「挂了子UMG，并没有在视口显示」）。
 *
 * 根因：config.ts 把 `{ name, ref }` 节点换成没有子控件的 UserWidget 叶子，近似预览（approx.ts）给它 160×48 的期望大小、
 * paint.ts 画成斜线占位块，从来没人去读 ref 指的子配置——放进 WidgetSwitcher 时被 Fill 撑满，看起来就是一整块空白。
 * UE 设计器里子 WBP 是实例化后整棵画出来的，这里照做：按 ref 读子配置（相对配置根，走 ext/forge/read），
 * 把子配置的控件树作为子界面节点唯一的子控件嫁接进来（子界面的根占满子界面节点的格子，和 UUserWidget 一样），
 * 子配置里的 ref 递归处理；成环、嵌套太深、文件不存在、解析失败都留在节点的 refError 上，画占位框写明原因，不静默空白。
 * 本文件全是纯函数（读文件由调用方注入），单测在 subref.test.ts。
 */

/** 子界面最多套这么多层：写错的配置不至于把页面拖死（UEKit 导入时成环会直接报错，这里只是兜底） */
export const MAX_REF_DEPTH = 6
/** 一次最多读这么多份子配置 */
export const MAX_REF_FILES = 64

/** 子配置读的结果；键是 refKey(from, ref) */
export interface SubConfig {
  /** 读到的文件（相对配置根） */
  file?: string
  doc?: UmgConfig
  error?: string
}
export type SubConfigs = Map<string, SubConfig>

export const refKey = (from: string, ref: string) => `${from}\n${ref}`

/**
 * ref 路径的候选（相对配置根）：UEKit 先按引用它的配置所在目录找，再按项目根、配置根找。
 * 网页只能经 ext/forge/read 读配置根里的文件，所以「项目根」那一档不找（配置根外的子配置画占位框说明）
 */
export function refCandidates(from: string, ref: string): string[] {
  const out: string[] = []
  const rel = resolveInclude(from, ref)
  if (rel) out.push(rel)
  const atRoot = resolveInclude('', ref)
  if (atRoot && !out.includes(atRoot)) out.push(atRoot)
  return out.filter((f) => /\.json$/i.test(f))
}

/** 配置节点树里的全部 ref（不进子配置） */
export function refsIn(root: CfgNode | undefined): string[] {
  const out: string[] = []
  const walk = (n: CfgNode) => {
    if (typeof n.ref === 'string' && n.ref) out.push(n.ref)
    for (const c of Array.isArray(n.children) ? n.children : []) if (c && typeof c === 'object') walk(c)
  }
  if (root && typeof root === 'object') walk(root)
  return out
}

/** 读一份子配置：返回解析好的文档，读不到 / 解析不了抛出写给人看的原因 */
export type LoadConfig = (file: string) => Promise<UmgConfig>

/**
 * 从主配置起把 ref 链上的子配置都读出来（广度优先、同一份文件只读一次，所以引用成环也会停）。
 * 每个候选路径依次试，全都读不到时记第一个候选的原因（最可能是用户想要的那个位置）。
 */
export async function loadSubConfigs(main: string, doc: UmgConfig | undefined, load: LoadConfig): Promise<SubConfigs> {
  const out: SubConfigs = new Map()
  const files = new Map<string, Promise<{ doc?: UmgConfig; error?: string }>>()
  const once = (f: string) => {
    let p = files.get(f)
    if (!p) {
      p = load(f).then(
        (d) => ({ doc: d }),
        (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }),
      )
      files.set(f, p)
    }
    return p
  }
  let level: { from: string; doc?: UmgConfig }[] = [{ from: main, doc }]
  for (let depth = 0; depth < MAX_REF_DEPTH && level.length; depth++) {
    const next: { from: string; doc?: UmgConfig }[] = []
    for (const { from, doc: d } of level) {
      for (const ref of refsIn(d?.root)) {
        const k = refKey(from, ref)
        if (out.has(k)) continue
        const cands = refCandidates(from, ref)
        if (!cands.length) {
          out.set(k, { error: t('ref "{r}" 要是配置根里的 .json 文件', { r: ref }) })
          continue
        }
        let got: SubConfig | undefined
        let firstErr = ''
        for (const f of cands) {
          if (!files.has(f) && files.size >= MAX_REF_FILES) {
            firstErr ||= t('子配置太多（超过 {n} 份），后面的没读', { n: MAX_REF_FILES })
            break
          }
          const fresh = !files.has(f)
          const r = await once(f)
          if (r.doc) {
            got = { file: f, doc: r.doc }
            if (fresh) next.push({ from: f, doc: r.doc })
            break
          }
          firstErr ||= r.error ?? ''
        }
        out.set(k, got ?? { error: firstErr || t('读不到 {r}', { r: ref }) })
      }
    }
    level = next
  }
  // 还剩没读的一层：嵌套太深，不再往下读，记原因（不然会一直当成「正在读」）
  for (const { from, doc: d } of level)
    for (const ref of refsIn(d?.root))
      if (!out.has(refKey(from, ref)))
        out.set(refKey(from, ref), { error: t('子界面嵌套超过 {n} 层，不再展开', { n: MAX_REF_DEPTH }) })
  return out
}

/** 子配置的节点换成 WNode 挂到子界面节点下：key 接着父路径，标上来源文件；at 去掉（不是这份配置的节点，细节面板只读） */
function subTree(doc: UmgConfig, file: string, parentKey: string): WNode | undefined {
  if (!doc.root || typeof doc.root !== 'object') return undefined
  const mark = (n: WNode): WNode => ({ ...n, at: undefined, src: file, children: n.children.map(mark) })
  return mark(fromConfig(resolveStyles(doc.root, doc.styles), parentKey))
}

/**
 * 把读到的子配置嫁接进控件树（纯函数）：subs 里还没有的（正在读）保持原样，读不到的标 refError。
 * main 是主配置文件（相对配置根）；不知道主配置在哪（资源页没有配置根）时传 undefined，ref 节点只标原因。
 */
export function graftRefs(root: WNode, main: string | undefined, subs: SubConfigs | undefined): WNode {
  const visit = (n: WNode, from: string, chain: string[]): WNode => {
    const kids = n.children.map((c) => visit(c, c.src ?? from, chain))
    const same = kids.every((c, i) => c === n.children[i])
    if (!n.ref) return same ? n : { ...n, children: kids }
    if (main === undefined)
      return { ...n, children: kids, refError: t('不知道配置根，读不到子界面：在 AssetForge 页打开这份配置看') }
    const s = subs?.get(refKey(from, n.ref))
    if (!s) return same ? n : { ...n, children: kids }
    if (s.error || !s.file || !s.doc)
      return { ...n, children: kids, refError: s.error || t('读不到 {r}', { r: n.ref }) }
    if (chain.includes(s.file))
      return {
        ...n,
        children: kids,
        subFile: s.file,
        refError: t('引用成环：{c}', { c: [...chain, s.file].join(' → ') }),
      }
    if (chain.length > MAX_REF_DEPTH)
      return {
        ...n,
        children: kids,
        subFile: s.file,
        refError: t('子界面嵌套超过 {n} 层，不再展开', { n: MAX_REF_DEPTH }),
      }
    const sub = subTree(s.doc, s.file, n.key)
    if (!sub) return { ...n, children: kids, subFile: s.file, refError: t('{f} 里没有 root 控件树', { f: s.file }) }
    // 子界面的根是子界面节点唯一的子控件（UE 里 UUserWidget 的 WidgetTree.RootWidget 占满整个控件）
    return { ...n, subFile: s.file, children: [visit(sub, s.file, [...chain, s.file])] }
  }
  return main === undefined && !hasRef(root) ? root : visit(root, main ?? '', main ? [main] : [])
}

const hasRef = (n: WNode): boolean => !!n.ref || n.children.some(hasRef)
