import { Box, ChevronRight, FileSymlink, Info } from 'lucide-react'
import { memo, useMemo, useRef, useState } from 'react'
import { Details } from '../../details/Details.tsx'
import { looksLikePath } from '../../details/model.ts'
import type { DetailsApi } from '../../details/rows.tsx'
import { t } from '../../host.ts'
import { PANE_FILL, PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '@panel/web/src/components/ui/split-pane'
import { Card } from '../../ui.tsx'
import { Hint } from './forge-parts.tsx'
import { previewProps } from './forge-preview-props.ts'
import type { PathSeg } from '../../../shared/forge-doc/locate.ts'
import { resolveStyles } from '../../../shared/forge-doc/styles.ts'

/**
 * 资源还没生成时的「资源」页签：配置格式本来就是一棵节点树（root: {class, name, props, slot?, children?}，
 * UEKit docs/asset-forge.md「配置」），这里把它画成和资源页一样的「左边树、右边属性」，只读。
 * 用户 2026-11-15：「这个 json 也可以认为是一个蓝图资源」。不经 UE，直接解析 forge.describe 回的配置原文。
 * 右边属性用和真实资源同一个细节面板（details/Details.tsx），分类、展开、色块、勾选和 UE 一样（用户 2026-11-16）；
 * 左边结构树能拖宽（控件名长，默认宽度放不下），宽度记在本机。
 * 设计稿 4.2 / 4.3.4：节点引用的样式（style）先套上再显示，和导入出来的一样；include 展开后的文档由外面给（doc），
 * 从片段文件来的节点在树上标出片段文件名。
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
  /** 在文档里的位置（root、children 下标）：查它是不是从片段来的 */
  path: PathSeg[]
  /** 父节点的类：插槽属性的分类写成「Slot (HorizontalBoxSlot)」 */
  parent?: string
}

function flatten(n: CfgNode, depth: number, key: string, out: Line[], path: PathSeg[], parent?: string) {
  out.push({ key, depth, node: n, parent, path })
  ;(n.children ?? []).forEach((c, i) =>
    flatten(c, depth + 1, `${key}/${c.name ?? i}`, out, [...path, 'children', i], n.class),
  )
  return out
}

const noop = () => undefined

/** 只读预览的细节面板动作：不改值、不固定监视；对象引用能点时交给外面（UE 页里跳到资源页） */
function previewApi(onOpen?: (path: string) => void): Omit<DetailsApi, 'q'> {
  return {
    busy: '',
    version: 0,
    changed: noop,
    isChanged: () => false,
    setValue: noop,
    arrayOp: noop,
    reset: noop,
    openRef: (p) => (onOpen && looksLikePath(p) ? () => onOpen(p) : undefined),
    loadFull: async () => undefined,
  }
}

export function ForgeConfigPreview({
  text,
  truncated,
  loading,
  error,
  note,
  onOpen,
  initial = '',
  doc: given,
  fragmentAt,
}: {
  text?: string
  /** 展开 include 之后的文档；不给就自己解析 text */
  doc?: unknown
  /** 某个位置来自哪个片段文件（相对配置根） */
  fragmentAt?: (path: PathSeg[]) => string | undefined
  truncated?: boolean
  loading?: boolean
  error?: string
  note: string
  /** 点属性里的资源引用（/Game/…）：UE 页里跳到资源页；设置里的示例不给 */
  onOpen?: (path: string) => void
  /** 一开始选中的节点（结构里的路径，如 Root/Shell/Title）；不给就选根 */
  initial?: string
}) {
  const doc = useMemo(() => {
    const d = (given as { root?: CfgNode; styles?: unknown } | undefined) ?? (text ? parseConfig(text) : undefined)
    return d?.root ? { ...d, root: resolveStyles(d.root, (d as { styles?: unknown }).styles) } : d
  }, [given, text])
  const lines = useMemo(() => (doc?.root ? flatten(doc.root, 0, doc.root.name ?? 'root', [], ['root']) : []), [doc])
  const [sel, setSel] = useState(initial)
  const cur = lines.find((l) => l.key === sel) ?? lines[0]
  const pane = usePane('forge-preview-tree', '320px', 200)
  const treeRef = useRef<HTMLElement>(null)
  const why = t('按配置预览，只读：要改就改配置，导入后在真实资源上改')
  const props = useMemo(() => (cur ? previewProps(cur.node, cur.parent, why) : []), [cur, why])
  const api = useMemo(() => previewApi(onOpen), [onOpen])

  // 读不到就直说，不一直挂「读取中」
  if (text === undefined) return <Hint>{error || (loading ? t('读取中…') : t('没有配置原文'))}</Hint>
  if (!doc?.root)
    return (
      <Hint>
        {truncated
          ? t('配置太长，只拿到了前一部分，画不出结构：看「配置原文」或用编辑器打开')
          : t('配置里没有 root 节点，画不出结构：看「配置原文」')}
      </Hint>
    )
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <p className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:bg-accent/6 ue:px-5 ue:py-1.5 ue:text-footnote ue:text-fg">
        <Info className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent-text" />
        {note}
      </p>
      <div className={SPLIT_ROW}>
        <Card
          ref={treeRef}
          className={PANE_FIXED}
          style={pane.style('calc(100% - 360px)')}
          title={t('结构')}
          aside={t('来自配置')}
          bodyClass="ue:overflow-auto ue:py-1"
        >
          <PreviewTree lines={lines} cur={cur?.key} onPick={setSel} fragmentAt={fragmentAt} />
        </Card>
        <SplitHandle pane={pane} paneRef={treeRef} reserve={() => 360} />
        <Card
          className={PANE_FILL}
          title={<span className="ue:truncate ue:font-mono">{cur?.node.name ?? ''}</span>}
          aside={<span className="ue:truncate">{cur?.node.class}</span>}
          bodyClass="ue:flex ue:min-h-0 ue:flex-col"
        >
          {props.length ? (
            <Details key={cur?.key} props={props} api={api} />
          ) : (
            <Hint>{t('这个节点在配置里没写属性，导入后用默认值')}</Hint>
          )}
        </Card>
      </div>
    </div>
  )
}

/** 设置 →「组件」里的示例：一小份 UMG 配置（插槽、字体结构体、颜色、勾选、Behavior 分类都有） */
const SAMPLE = `{
  "kind": "umg-widget",
  "asset": "/Game/UI/WBP_Sample",
  "root": {
    "class": "Overlay", "name": "Root",
    "children": [
      { "class": "HorizontalBox", "name": "Shell", "children": [
        { "class": "TextBlock", "name": "BrandMarkText",
          "slot": { "Padding": { "Left": 8, "Top": 0, "Right": 8, "Bottom": 0 }, "HorizontalAlignment": "HAlign_Left", "VerticalAlignment": "VAlign_Center" },
          "props": {
            "Text": "AF",
            "Font": { "Size": 16, "TypefaceFontName": "Bold" },
            "ColorAndOpacity": { "SpecifiedColor": { "R": 0.9, "G": 0.55, "B": 0.2, "A": 1 } },
            "AutoWrapText": true,
            "Visibility": "SelfHitTestInvisible",
            "bIsEnabled": false
          } }
      ] }
    ]
  }
}`

export function ForgeConfigPreviewSpecimen() {
  return (
    <div className="ue:flex ue:h-[520px] ue:w-full ue:flex-col ue:overflow-hidden ue:rounded-lg ue:border ue:border-line">
      <ForgeConfigPreview
        text={SAMPLE}
        initial="Root/Shell/BrandMarkText"
        note={t('资源还没生成，下面是按配置画出来的结构和属性（只读），导入后换成 UE 里的真实资源')}
      />
    </div>
  )
}

/**
 * 结构树：一份界面配置能有几百个控件（示例界面约 610 个），拖分栏、选中都会让整页重渲染，
 * 树和每一行都 memo 住，只有选中变化的两行重画。
 */
const PreviewTree = memo(function PreviewTree({
  lines,
  cur,
  onPick,
  fragmentAt,
}: {
  lines: Line[]
  cur?: string
  onPick: (key: string) => void
  fragmentAt?: (path: PathSeg[]) => string | undefined
}) {
  return lines.map((l, i) => {
    // 只在片段开始的那个节点上标（子节点跟着同一个片段的不重复标）
    const f = fragmentAt?.(l.path)
    const parent = i > 0 && l.depth > 0 ? fragmentAt?.(l.path.slice(0, -2)) : undefined
    return (
      <TreeRow
        key={l.key}
        l={l}
        selected={l.key === cur}
        onPick={onPick}
        fragment={f && f !== parent ? f : undefined}
      />
    )
  })
})

const TreeRow = memo(function TreeRow({
  l,
  selected,
  onPick,
  fragment,
}: {
  l: Line
  selected: boolean
  onPick: (key: string) => void
  /** 从这个节点开始来自片段文件 */
  fragment?: string
}) {
  return (
    <button
      type="button"
      aria-selected={selected}
      onClick={() => onPick(l.key)}
      title={[l.node.name, l.node.class].filter(Boolean).join('\n')}
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
      {fragment && (
        <span title={t('来自片段文件 {f}', { f: fragment })} className="ue:shrink-0 ue:text-accent-text">
          <FileSymlink className="ue:h-3 ue:w-3" />
        </span>
      )}
      {/* 类名让着控件名：栏窄时先截类名（控件名才是要找的） */}
      <span className="ue:max-w-[45%] ue:min-w-0 ue:shrink ue:truncate ue:text-caption ue:text-subtle">
        {l.node.class}
      </span>
    </button>
  )
})
