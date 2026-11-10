import { ChevronDown, ChevronRight, CornerLeftUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { op, useLoad } from './api.ts'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'
import { Props } from './Props.tsx'
import { SplitHandle, usePane } from './split.tsx'
import { Badge } from './ui.tsx'

interface Node {
  path: string
  name: string
  class: string
  visibility: string
  user: boolean
  truncated?: boolean
  children: Node[]
}

/**
 * 运行时对象的右栏：UMG 控件（UserWidget 实例或里面的控件）左边是控件树、右边是选中控件的参数，
 * 像 UE 的 UMG 编辑器的层级 + 细节面板，只是不画中间的样式预览；其他对象只显示属性。
 * 桥接是旧版本（没有 umg.tree）或对象不是控件时，退回只显示属性
 */
export function Inspect({ path, onOpen, cdo }: { path: string; onOpen: (path: string) => void; cdo?: boolean }) {
  const { project, target, go } = useUe()
  const [sel, setSel] = useState(path)
  // 控件树宽度可拖（md 以上左右排时），右边参数至少留 280px
  const pane = usePane('umg.tree', '42%', 180)
  const treeRef = useRef<HTMLDivElement>(null)
  useEffect(() => setSel(path), [path])
  const tree = useLoad(
    () =>
      op<{ root: Node | null; parent?: string }>(project.id, 'umg.tree', { path }, target).catch(
        (): { root: Node | null; parent?: string } => ({ root: null }),
      ),
    [path, target.instance, target.world],
  )
  const root = tree.data?.root
  const parent = tree.data?.parent
  // 先等控件树回来再决定布局，免得属性先按单栏读一遍、再换成两栏又读一遍
  if (!tree.data) return <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('读取中…')}</p>
  if (!root) return <Props key={path} path={path} onOpen={onOpen} cdo={cdo} />
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:md:flex-row">
      <div
        ref={treeRef}
        style={pane.style('calc(100% - 280px)')}
        className="ue:relative ue:flex ue:max-h-[40%] ue:min-h-0 ue:shrink-0 ue:flex-col ue:border-b ue:border-line ue:md:max-h-none ue:md:w-(--ue-w) ue:md:max-w-(--ue-max) ue:md:border-r ue:md:border-b-0"
      >
        <div className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-3 ue:py-2.5">
          <span className="ue:text-footnote ue:font-medium ue:text-muted">{t('控件树')}</span>
          {parent && (
            <button
              type="button"
              onClick={() => go('objects', parent)}
              title={parent}
              className="ue:ml-auto ue:inline-flex ue:cursor-pointer ue:items-center ue:gap-1 ue:text-caption ue:text-accent-text ue:hover:underline"
            >
              <CornerLeftUp className="ue:h-3.5 ue:w-3.5" />
              {t('上一层')}
            </button>
          )}
        </div>
        <ul className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:py-1">
          <TreeRow node={root} depth={0} sel={sel} onSel={setSel} />
        </ul>
        <SplitHandle pane={pane} paneRef={treeRef} reserve={() => 280} edge />
      </div>
      <div className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col">
        <Props key={sel} path={sel} onOpen={onOpen} />
      </div>
    </div>
  )
}

/** 一行控件：嵌套的 UserWidget 默认收起（它自己的整棵树），其余默认展开；隐藏的控件淡显 */
function TreeRow({ node, depth, sel, onSel }: { node: Node; depth: number; sel: string; onSel: (p: string) => void }) {
  const { cn } = h()
  const [open, setOpen] = useState(depth === 0 || !node.user)
  const hidden = node.visibility === 'Collapsed' || node.visibility === 'Hidden'
  const has = node.children.length > 0
  return (
    <li>
      <div
        className={cn(
          'ue:flex ue:h-7 ue:items-center ue:gap-1 ue:pr-2 ue:hover:bg-hover',
          sel === node.path && 'ue:bg-sel ue:hover:bg-sel',
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {has ? (
          <button
            type="button"
            aria-label={open ? t('收起') : t('展开')}
            onClick={() => setOpen((v) => !v)}
            className="ue:cursor-pointer ue:text-subtle ue:hover:text-fg"
          >
            {open ? <ChevronDown className="ue:h-3.5 ue:w-3.5" /> : <ChevronRight className="ue:h-3.5 ue:w-3.5" />}
          </button>
        ) : (
          <span className="ue:w-3.5 ue:shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSel(node.path)}
          title={node.path}
          className={cn(
            'ue:flex ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:items-baseline ue:gap-2 ue:text-left',
            hidden && 'ue:opacity-50',
          )}
        >
          <span className="ue:truncate ue:text-body ue:text-fg">{node.name}</span>
          <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{node.class}</span>
        </button>
        {hidden && <Badge>{node.visibility}</Badge>}
      </div>
      {open && has && (
        <ul>
          {node.children.map((c) => (
            <TreeRow key={c.path} node={c} depth={depth + 1} sel={sel} onSel={onSel} />
          ))}
        </ul>
      )}
      {open && node.truncated && (
        <p className="ue:text-caption ue:text-subtle" style={{ paddingLeft: 8 + (depth + 1) * 14 + 18 }}>
          {t('层级太深或控件太多，后面的没列出')}
        </p>
      )}
    </li>
  )
}
