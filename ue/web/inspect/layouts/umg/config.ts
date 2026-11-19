import { shortCls, visOf, type WNode } from './model.ts'

/**
 * AssetForge 的 UMG 配置（UEKit docs/asset-forge.md）：root 是节点树 {class, name, props?, slot?, children?, ref?}，
 * 动画在 animations 段（设计稿 4.1）。配置允许 // 注释：去掉字符串外面的注释再 JSON.parse。纯函数，单测直接 import。
 */
export interface CfgNode {
  class?: string
  name?: string
  props?: Record<string, unknown>
  slot?: Record<string, unknown>
  children?: CfgNode[]
  /** 子界面引用（另一份配置）：近似预览画成占位块 */
  ref?: string
  isVariable?: boolean
  variable?: boolean
}

export interface UmgConfig {
  kind?: string
  asset?: string
  parent?: string
  root?: CfgNode
  animations?: unknown
}

export function stripComments(text: string) {
  let out = ''
  let str = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (str) {
      out += c
      if (c === '\\') out += text[++i] ?? ''
      else if (c === '"') str = false
    } else if (c === '"') {
      str = true
      out += c
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else out += c
  }
  return out
}

let last: { text: string; doc: UmgConfig | undefined } | undefined

/** 解析配置原文；解析不了返回 undefined。同一份原文只解析一次（挑布局、画预览都要用） */
export function parseUmgConfig(text?: string): UmgConfig | undefined {
  if (!text) return undefined
  if (last?.text === text) return last.doc
  let doc: UmgConfig | undefined
  try {
    const v = JSON.parse(stripComments(text)) as unknown
    doc = v && typeof v === 'object' && !Array.isArray(v) ? (v as UmgConfig) : undefined
  } catch {
    doc = undefined
  }
  last = { text, doc }
  return doc
}

export const configKind = (text?: string) => parseUmgConfig(text)?.kind

/** 配置的节点树换成 WNode：key 从根起按名字拼（和动画 target 一样），没名字的用下标 */
export function fromConfig(n: CfgNode, parentKey = '', index = 0): WNode {
  const name = n.name ?? `${shortCls(n.class) || 'Widget'}_${index}`
  const key = parentKey ? `${parentKey}/${name}` : name
  const props = n.props ?? {}
  const isVar = n.isVariable ?? n.variable ?? (props.bIsVariable as boolean | undefined)
  return {
    key,
    name,
    cls: n.ref && !n.class ? 'UserWidget' : shortCls(n.class) || 'Widget',
    isVar: isVar || undefined,
    visibility: visOf(props.Visibility),
    active: typeof props.ActiveWidgetIndex === 'number' ? props.ActiveWidgetIndex : undefined,
    user: !!n.ref || undefined,
    asset: n.ref,
    props,
    slot: n.slot,
    children: (n.children ?? []).map((c, i) => fromConfig(c, key, i)),
  }
}

/** 树里的控件个数（页头「控件树 96 个控件」） */
export const countNodes = (n?: WNode): number => (n ? 1 + n.children.reduce((s, c) => s + countNodes(c), 0) : 0)
