import { ChevronRight, FileSymlink } from 'lucide-react'
import { memo, useMemo, useState, type ReactNode } from 'react'
import type { PathSeg } from '../../../../shared/forge-doc/locate.ts'
import { sectionIds } from '../../../../shared/forge-doc/sections.ts'
import { h, t } from '../../../host.ts'
import { sectionLabel } from '../forge-config/section-label.ts'
import { buildSections, countMarks, type MarkAttr, type MarkNode, type MarkSection } from './markup.ts'

/**
 * 「标记视图」（设计稿 4.2 第 1 条、4.3.3）：把（展开 include 之后的）AssetForge 配置按段画成类似 XAML 的缩进标签，只读。
 * 控件树段是 `<Button Name="Go" Style="NavButton" Slot.Padding="8, 0, 8, 0">` 这样的标签树，动画段一条轨道一行，
 * 样式段一个样式一行。点标签或属性回调 onJump（AssetForge 页跳到「配置原文」对应的行），片段来的段 / 节点标出文件、点了 onOpenFragment。
 * 共用组件：AssetForge 页右栏、以后 UMG 查看页的「配置原文」视图都用它；别的 kind 按通用规则画（标量当属性、对象数组当子标签）。
 */
export interface ForgeMarkupProps {
  /** 展开 include 之后的文档 */
  doc: unknown
  /** forge.kinds kind= 的 schema（有 sections 时按它分段）；不给用内置段表 */
  schema?: unknown
  /** 某个位置来自哪个片段文件（相对配置根）；没有 include 时不给 */
  fragmentAt?: (path: PathSeg[]) => string | undefined
  onJump?: (path: PathSeg[]) => void
  onOpenFragment?: (file: string) => void
}

/** 节点超过这么多时默认收起第三层往下，大界面（几百个控件）先看骨架 */
const BIG = 400

export function ForgeMarkupView({ doc, schema, fragmentAt, onJump, onOpenFragment }: ForgeMarkupProps) {
  const kind = (doc as { kind?: unknown } | undefined)?.kind
  const ids = useMemo(() => sectionIds(schema, kind), [schema, kind])
  const sections = useMemo(() => buildSections(doc, ids, fragmentAt), [doc, ids, fragmentAt])
  const total = useMemo(
    () => sections.reduce((n, s) => n + s.nodes.reduce((m, x) => m + countMarks(x), 0), 0),
    [sections],
  )
  // 用户点过的收起 / 展开；没点过的按默认（大界面收起深层）
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map())
  const isOpen = (id: string, depth: number) => toggled.get(id) ?? !(total > BIG && depth >= 2)
  const toggle = (id: string, depth: number) => setToggled((m) => new Map(m).set(id, !isOpen(id, depth)))
  const ctx: Ctx = { isOpen, toggle, onJump, onOpenFragment }
  return (
    <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:rounded-lg ue:border ue:border-line ue:bg-sel/25 ue:py-1 ue:font-mono ue:text-footnote ue:leading-5">
      {sections.map((s) => (
        <Section key={s.id} s={s} label={sectionLabel(s.id, typeof kind === 'string' ? kind : undefined)} ctx={ctx} />
      ))}
    </div>
  )
}

interface Ctx {
  isOpen: (id: string, depth: number) => boolean
  toggle: (id: string, depth: number) => void
  onJump?: (path: PathSeg[]) => void
  onOpenFragment?: (file: string) => void
}

function Section({ s, label, ctx }: { s: MarkSection; label: string; ctx: Ctx }) {
  const { cn } = h()
  const key = `§${s.id}`
  const open = ctx.isOpen(key, 0)
  return (
    <section className="ue:border-b ue:border-line/60 ue:last:border-b-0">
      <div className="ue:sticky ue:top-0 ue:z-1 ue:flex ue:items-center ue:gap-2 ue:bg-card ue:px-2 ue:py-1 ue:font-sans">
        <button
          type="button"
          onClick={() => ctx.toggle(key, 0)}
          className="ue:flex ue:min-w-0 ue:cursor-pointer ue:items-center ue:gap-1 ue:text-caption ue:font-medium ue:text-muted ue:hover:text-fg"
        >
          <ChevronRight className={cn('ue:h-3 ue:w-3 ue:shrink-0 ue:transition-transform', open && 'ue:rotate-90')} />
          {label}
          {s.id !== label && <span className="ue:font-mono ue:font-normal ue:text-subtle">{s.id}</span>}
        </button>
        {s.fragment && <FragmentChip file={s.fragment} ctx={ctx} />}
      </div>
      {open && s.nodes.map((n) => <Node key={n.id} n={n} depth={1} ctx={ctx} />)}
    </section>
  )
}

function FragmentChip({ file, ctx }: { file: string; ctx: Ctx }) {
  const name = file.split('/').pop()
  return (
    <button
      type="button"
      disabled={!ctx.onOpenFragment}
      title={t('来自片段文件 {f}：点一下打开', { f: file })}
      onClick={(e) => {
        e.stopPropagation()
        ctx.onOpenFragment?.(file)
      }}
      className="ue:inline-flex ue:max-w-60 ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded ue:bg-accent/10 ue:px-1.5 ue:font-sans ue:text-caption ue:text-accent-text ue:hover:bg-accent/20 ue:disabled:cursor-default"
    >
      <FileSymlink className="ue:h-3 ue:w-3 ue:shrink-0" />
      <span className="ue:truncate">{name}</span>
    </button>
  )
}

const Node = memo(function Node({ n, depth, ctx }: { n: MarkNode; depth: number; ctx: Ctx }) {
  const { cn } = h()
  const kids = n.children.length > 0
  const open = kids && ctx.isOpen(n.id, depth)
  const pad = { paddingLeft: `calc(${depth - 1} * 2ch + 0.5rem)` }
  const tag = (close?: boolean) => (
    <button
      type="button"
      disabled={!ctx.onJump}
      onClick={() => ctx.onJump?.(n.path)}
      className="ue:cursor-pointer ue:font-medium ue:text-accent-text ue:hover:underline ue:disabled:cursor-default ue:disabled:no-underline"
    >
      {close ? `</${n.tag}` : `<${n.tag}`}
    </button>
  )
  return (
    <>
      {n.note && (
        <div className="ue:truncate ue:pr-3 ue:text-subtle" style={pad} title={n.note}>
          {`<!-- ${n.note} -->`}
        </div>
      )}
      <div className="ue:flex ue:items-start ue:pr-3 ue:hover:bg-sel/50" style={pad}>
        <span className="ue:flex ue:h-5 ue:w-4 ue:shrink-0 ue:items-center">
          {kids && (
            <button
              type="button"
              aria-label={open ? t('收起') : t('展开')}
              onClick={() => ctx.toggle(n.id, depth)}
              className="ue:cursor-pointer ue:text-subtle ue:hover:text-fg"
            >
              <ChevronRight className={cn('ue:h-3 ue:w-3 ue:transition-transform', open && 'ue:rotate-90')} />
            </button>
          )}
        </span>
        <span className="ue:flex ue:min-w-0 ue:flex-wrap ue:items-center ue:gap-x-[1ch]">
          {tag()}
          {n.attrs.map((a, i) => (
            <Attr key={i} a={a} onJump={ctx.onJump} />
          ))}
          {/* 有子标签时 > 紧贴前一个属性（XML 的写法），自闭合的 /> 前留空格 */}
          <span className={cn('ue:text-accent-text', kids && n.attrs.length > 0 && 'ue:-ml-[1ch]')}>
            {kids ? '>' : '/>'}
            {kids && !open && <Collapsed n={n} />}
          </span>
          {n.fragment && <FragmentChip file={n.fragment} ctx={ctx} />}
        </span>
      </div>
      {open && n.children.map((c) => <Node key={c.id} n={c} depth={depth + 1} ctx={ctx} />)}
      {open && (
        <div className="ue:pr-3" style={pad}>
          <span className="ue:inline-block ue:w-4" />
          {tag(true)}
          <span className="ue:text-accent-text">{'>'}</span>
        </div>
      )}
    </>
  )
})

/** 收起时：`<Tag …>⋯ 12 个</Tag>` 一行带过 */
function Collapsed({ n }: { n: MarkNode }) {
  return (
    <>
      <span className="ue:mx-1 ue:rounded ue:bg-sel ue:px-1 ue:font-sans ue:text-caption ue:text-muted">
        {t('{n} 个', { n: countMarks(n) - 1 })}
      </span>
      {`</${n.tag}>`}
    </>
  )
}

function Attr({ a, onJump }: { a: MarkAttr; onJump?: (path: PathSeg[]) => void }) {
  let value: ReactNode = null
  if (!a.flag)
    value = (
      <>
        <span className="ue:text-subtle">=</span>
        {a.swatch && (
          <span
            className="ue:mr-1 ue:inline-block ue:h-2.5 ue:w-2.5 ue:rounded-sm ue:border ue:border-line ue:align-[-1px]"
            style={{ background: a.swatch }}
          />
        )}
        <span className={a.str ? 'ue:text-success' : 'ue:text-warning'}>{a.str ? `"${a.text}"` : a.text}</span>
      </>
    )
  return (
    <button
      type="button"
      disabled={!onJump}
      onClick={() => onJump?.(a.path)}
      title={a.full}
      className="ue:cursor-pointer ue:rounded-sm ue:text-left ue:break-all ue:hover:bg-sel ue:disabled:cursor-default"
    >
      <span className={a.flag ? 'ue:text-run' : 'ue:text-muted'}>{a.name}</span>
      {value}
    </button>
  )
}
