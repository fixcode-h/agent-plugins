import { Copy, Pencil, SquarePen } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ppost } from '../../api.ts'
import { h, t } from '../../host.ts'
import { copyText } from '@panel/web/src/components/ui/item-menu'
import { findSections, resolveInclude, sectionIdsOf, type SectionInfo } from '../../../shared/forge-doc/index.ts'
import { ForgeCodeView } from './ForgeCodeView.tsx'
import { ForgeConfigEdit } from './ForgeConfigEdit.tsx'
import { ErrorBox, Hint, Loading } from './forge-parts.tsx'
import { SectionNav } from './forge-config/SectionNav.tsx'
import { sectionLabel } from './forge-config/section-label.ts'
import type { ForgeExpanded } from './forge-config/use-expanded.ts'

/**
 * 「配置原文」页签：只读代码块，带行号和简单的 JSON 着色；右上角「编辑」切到页面里直接改（ForgeConfigEdit.tsx，
 * 用户 2026-11-16 同意；原先设计稿 §5 只读、编辑交给外部编辑器），也留着「用编辑器打开」「复制」。
 * 面板共用控件里没有代码块，代码块在 ForgeCodeView.tsx 自己画（大配置只画看得见的行）；颜色只用主题色。
 * 解析失败时说明里常带「第 N 行」，那一行用 danger 底标出来。
 * 按段（设计稿 4.3.3）：左边段导航（段名、行数、行号范围，点了跳过去，能折叠，能「只编辑这一段」）；
 * 配置 include 了片段文件（4.3.4）时导航上面列出文件，切过去看和改片段，include 的段点一下打开它的片段。
 */
export interface ConfigFocus {
  /** 相对配置根 */
  file: string
  line: number
  nonce: number
}

export function ForgeConfig({
  loading,
  error,
  text,
  truncated,
  badLine,
  onOpen,
  edit,
  expanded,
  kind,
  focus,
}: {
  loading: boolean
  error: string
  text?: string
  truncated?: boolean
  /** 要标红的行（从 1 数），解析失败时从说明里取 */
  badLine?: number
  onOpen: () => void
  /** 能在页面里编辑时给：项目、配置根和这份配置的相对路径 */
  edit?: { project: string; configRoot: string; path: string }
  /** 展开 include 的结果：有片段时能切到片段文件 */
  expanded?: ForgeExpanded
  kind?: string
  /** 标记视图点过来的位置：切到那份文件、展开所在的段、滚过去 */
  focus?: ConfigFocus
}) {
  const { ui } = h()
  const main = edit?.path ?? ''
  const [file, setFile] = useState(main)
  const [editing, setEditing] = useState<{ section?: string }>()
  // 折起来的段：按文件分开记（切到片段再切回来，主文件折的还在）
  const [folded, setFolded] = useState<Map<string, Set<string>>>(new Map())
  const [jump, setJump] = useState<{ line: number; nonce: number }>()

  const cur = file === main ? text : expanded?.texts.get(file)
  const sections = useMemo(() => {
    if (cur === undefined) return []
    try {
      return findSections(cur, sectionIdsOf(cur))
    } catch {
      return []
    }
  }, [cur])
  const foldSet = folded.get(file) ?? new Set<string>()
  const folds = sections
    .filter((s) => foldSet.has(s.id) && s.contiguous)
    .map((s) => ({ start: s.startLine, end: s.endLine }))

  const setFold = (f: string, ids: Set<string>) => setFolded((m) => new Map(m).set(f, ids))
  const goLine = (line: number) => setJump((j) => ({ line, nonce: (j?.nonce ?? 0) + 1 }))
  const unfoldAt = (f: string, line: number, list: SectionInfo[]) => {
    const set = folded.get(f)
    if (!set?.size) return
    const hit = list.filter((s) => set.has(s.id) && line > s.startLine && line <= s.endLine)
    if (hit.length) setFold(f, new Set([...set].filter((id) => !hit.some((s) => s.id === id))))
  }
  // 标记视图点过来：切文件，所在段折着就打开，再滚过去
  useEffect(() => {
    if (!focus) return
    setEditing(undefined)
    setFile(focus.file)
    setJump({ line: focus.line, nonce: focus.nonce })
    const t2 = focus.file === main ? text : expanded?.texts.get(focus.file)
    if (t2 !== undefined)
      try {
        unfoldAt(focus.file, focus.line, findSections(t2, sectionIdsOf(t2)))
      } catch {
        // 读不懂的文件没有段可展开
      }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce])

  if (editing && edit)
    return (
      <ForgeConfigEdit
        project={edit.project}
        configRoot={edit.configRoot}
        path={file}
        section={editing.section}
        sectionName={editing.section ? sectionLabel(editing.section, kind) : undefined}
        onDone={() => setEditing(undefined)}
      />
    )
  if (error) return <ErrorBox>{error}</ErrorBox>
  if (text === undefined) return loading ? <Loading /> : <Hint>{t('没有配置原文')}</Hint>
  const openFile = () =>
    file === main || !edit
      ? onOpen()
      : void ppost(edit.project, 'ext/forge/file', { root: edit.configRoot, path: file, action: 'open' }).catch(
          (e: Error) => h().toast.error(e.message),
        )
  const files = expanded?.fragments.length ? [main, ...expanded.fragments] : []
  const issues = [...(expanded?.errors ?? []), ...(expanded?.warnings ?? [])]
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-2 ue:p-4">
      <div className="ue:flex ue:items-center ue:justify-end ue:gap-1.5">
        {file !== main && (
          <span className="ue:mr-auto ue:truncate ue:text-footnote ue:text-muted" title={file}>
            {t('片段文件 {f}', { f: file })}
          </span>
        )}
        {edit && (
          <ui.Button size="sm" onClick={() => setEditing({})}>
            <Pencil className="ue:h-3.5 ue:w-3.5" /> {t('编辑')}
          </ui.Button>
        )}
        <ui.Button size="sm" variant="secondary" onClick={openFile}>
          <SquarePen className="ue:h-3.5 ue:w-3.5" /> {t('用编辑器打开')}
        </ui.Button>
        <ui.Button size="sm" variant="secondary" onClick={() => copyText(cur ?? '')}>
          <Copy className="ue:h-3.5 ue:w-3.5" /> {t('复制')}
        </ui.Button>
      </div>
      {issues.length > 0 && (
        <ul className="ue:flex ue:flex-col ue:gap-0.5 ue:text-footnote">
          {expanded?.errors.map((e) => (
            <li key={e} className="ue:text-danger">
              {e}
            </li>
          ))}
          {expanded?.warnings.map((e) => (
            <li key={e} className="ue:text-warning">
              {e}
            </li>
          ))}
        </ul>
      )}
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-2 ue:md:flex-row">
        {(sections.length > 1 || files.length > 0) && (
          <SectionNav
            sections={sections}
            kind={file === main ? kind : undefined}
            files={files}
            file={file}
            folded={foldSet}
            onFile={(f) => {
              setFile(f)
              setJump(undefined)
            }}
            onJump={goLine}
            onFold={(id) => {
              const next = new Set(foldSet)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              setFold(file, next)
            }}
            onFoldAll={(all) =>
              setFold(file, new Set(all ? sections.filter((s) => s.contiguous).map((s) => s.id) : []))
            }
            onEditSection={edit ? (id) => setEditing({ section: id }) : undefined}
            onInclude={(rel) => {
              // 路径相对现在看的这份文件；片段读不到时切过去显示「读不到」，错误在上面列着
              const target = resolveInclude(file, rel)
              if (!target) return
              setFile(target)
              setJump(undefined)
            }}
          />
        )}
        {cur === undefined ? (
          <Hint>{t('读不到这份文件')}</Hint>
        ) : (
          <div className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col">
            <ForgeCodeView
              text={cur}
              badLine={file === main ? badLine : undefined}
              folds={folds}
              onUnfold={(start) =>
                setFold(
                  file,
                  new Set([...foldSet].filter((id) => sections.find((s) => s.id === id)?.startLine !== start)),
                )
              }
              focus={jump}
            />
          </div>
        )}
      </div>
      {truncated && <p className="ue:text-caption ue:text-subtle">{t('配置太长，只显示了前一部分')}</p>}
    </div>
  )
}

/** 从解析失败的说明里找行号（UEKit 的说明写「第 N 行」，英文版写 line N） */
export function lineFromMessage(msg?: string) {
  const m = msg?.match(/第\s*(\d+)\s*行|line\s+(\d+)/i)
  return m ? Number(m[1] ?? m[2]) : undefined
}
