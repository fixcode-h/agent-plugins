import { Box, ChevronRight, Info } from 'lucide-react'
import { useMemo, useState } from 'react'
import { show } from '../../api.ts'
import { h, t } from '../../host.ts'
import { Card } from '../../ui.tsx'
import { Hint } from './forge-parts.tsx'

/**
 * 资源还没生成时的「资源」页签：配置格式本来就是一棵节点树（root: {class, name, props, slot?, children?}，
 * UEKit docs/asset-forge.md「配置」），这里把它画成和资源页一样的「左边树、右边属性」，只读。
 * 用户 2026-11-15：「这个 json 也可以认为是一个蓝图资源」。不经 UE，直接解析 forge.describe 回的配置原文。
 */
interface CfgNode {
  class?: string
  name?: string
  props?: Record<string, unknown>
  slot?: Record<string, unknown>
  children?: CfgNode[]
}

/** 配置允许 // 注释：去掉字符串外面的注释再 JSON.parse */
export function parseConfig(text: string): { root?: CfgNode; parent?: string } | undefined {
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
  try {
    return JSON.parse(out) as { root?: CfgNode; parent?: string }
  } catch {
    return undefined
  }
}

interface Line {
  key: string
  depth: number
  node: CfgNode
}

function flatten(n: CfgNode, depth: number, key: string, out: Line[]) {
  out.push({ key, depth, node: n })
  ;(n.children ?? []).forEach((c, i) => flatten(c, depth + 1, `${key}/${c.name ?? i}`, out))
  return out
}

export function ForgeConfigPreview({ text, truncated, note }: { text?: string; truncated?: boolean; note: string }) {
  const { cn } = h()
  const doc = useMemo(() => (text ? parseConfig(text) : undefined), [text])
  const lines = useMemo(() => (doc?.root ? flatten(doc.root, 0, doc.root.name ?? 'root', []) : []), [doc])
  const [sel, setSel] = useState('')
  const cur = lines.find((l) => l.key === sel) ?? lines[0]

  if (text === undefined) return <Hint>{t('读取中…')}</Hint>
  if (!doc?.root)
    return (
      <Hint>
        {truncated
          ? t('配置太长，只拿到了前一部分，画不出结构：看「配置原文」或用编辑器打开')
          : t('配置里没有 root 节点，画不出结构：看「配置原文」')}
      </Hint>
    )
  const sections: [string, Record<string, unknown> | undefined][] = [
    [t('属性'), cur?.node.props],
    [t('插槽'), cur?.node.slot],
  ]
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <p className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:bg-accent/6 ue:px-5 ue:py-1.5 ue:text-footnote ue:text-fg">
        <Info className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent-text" />
        {note}
      </p>
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:gap-2 ue:p-2">
        <Card
          className="ue:w-64 ue:shrink-0"
          title={t('结构')}
          aside={t('来自配置')}
          bodyClass="ue:overflow-auto ue:py-1"
        >
          {lines.map((l) => (
            <button
              key={l.key}
              type="button"
              aria-selected={l === cur}
              onClick={() => setSel(l.key)}
              style={{ paddingLeft: 8 + l.depth * 14 }}
              className="ue:flex ue:h-7 ue:w-full ue:cursor-pointer ue:items-center ue:gap-1.5 ue:pr-2 ue:text-left ue:text-body ue:text-fg ue:hover:bg-sel/60 ue:aria-selected:bg-sel ue:aria-selected:font-medium"
            >
              {l.node.children?.length ? (
                <ChevronRight className="ue:h-3 ue:w-3 ue:shrink-0 ue:rotate-90 ue:text-subtle" />
              ) : (
                <span className="ue:w-3 ue:shrink-0" />
              )}
              <Box className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
              <span className="ue:min-w-0 ue:flex-1 ue:truncate">{l.node.name ?? t('（没有名字）')}</span>
              <span className="ue:shrink-0 ue:truncate ue:text-caption ue:text-subtle">{l.node.class}</span>
            </button>
          ))}
        </Card>
        <Card
          className="ue:min-w-0 ue:flex-1"
          title={cur?.node.name ?? ''}
          aside={cur?.node.class}
          bodyClass="ue:overflow-auto"
        >
          {sections.map(([title, obj]) =>
            obj && Object.keys(obj).length ? (
              <div key={title}>
                <div className="ue:bg-sel/35 ue:px-3 ue:py-1 ue:text-caption ue:text-subtle">{title}</div>
                {Object.entries(obj).map(([k, v]) => (
                  <div
                    key={k}
                    className={cn(
                      'ue:grid ue:min-h-8 ue:grid-cols-[minmax(140px,220px)_minmax(0,1fr)] ue:items-center ue:border-b ue:border-line/50 ue:text-footnote',
                    )}
                  >
                    <span className="ue:truncate ue:border-r ue:border-line/50 ue:px-3 ue:text-fg" title={k}>
                      {k}
                    </span>
                    <span className="ue:truncate ue:px-3 ue:font-mono ue:text-muted" title={show(v)}>
                      {show(v)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null,
          )}
          {!Object.keys(cur?.node.props ?? {}).length && !Object.keys(cur?.node.slot ?? {}).length && (
            <Hint>{t('这个节点在配置里没写属性，导入后用默认值')}</Hint>
          )}
        </Card>
      </div>
    </div>
  )
}
