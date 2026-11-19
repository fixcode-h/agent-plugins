import { ChevronRight, FileJson, FileSymlink, ListCollapse, ListTree, Pencil } from 'lucide-react'
import type { SectionInfo } from '../../../../shared/forge-doc/sections.ts'
import { h, t } from '../../../host.ts'
import { sectionLabel } from './section-label.ts'

/**
 * 「配置原文」左边的段导航（设计稿 4.3.3）：一段一行（段名、字段名、行数、行号范围），点一下跳到那一段；
 * 行首箭头折叠 / 展开，悬停出「只编辑这一段」。段是 include 的片段时标出片段文件，点了切过去（4.3.4）。
 * 配置有片段文件时上面先列文件（主文件 + 片段），切换看哪一份。
 */
export function SectionNav({
  sections,
  kind,
  files,
  file,
  folded,
  onFile,
  onJump,
  onFold,
  onFoldAll,
  onEditSection,
  onInclude,
}: {
  sections: SectionInfo[]
  kind?: string
  /** 主文件 + 片段文件（没有片段时为空，不显示文件列表） */
  files: string[]
  file: string
  folded: Set<string>
  onFile: (file: string) => void
  onJump: (line: number) => void
  onFold: (id: string) => void
  onFoldAll: (fold: boolean) => void
  onEditSection?: (id: string) => void
  /** 点了 include 的段：原文写的片段路径 */
  onInclude: (rel: string) => void
}) {
  const { ui, cn } = h()
  const anyOpen = sections.some((s) => s.contiguous && !folded.has(s.id))
  return (
    <nav
      aria-label={t('段导航')}
      className="ue:flex ue:max-h-56 ue:shrink-0 ue:flex-col ue:overflow-auto ue:rounded-lg ue:border ue:border-line ue:py-1 ue:md:max-h-none ue:md:w-56"
    >
      {files.length > 0 && (
        <>
          <div className="ue:px-2.5 ue:pt-1 ue:pb-0.5 ue:text-caption ue:text-subtle">{t('文件')}</div>
          {files.map((f, i) => (
            <button
              key={f}
              type="button"
              aria-current={f === file}
              onClick={() => onFile(f)}
              title={f}
              className="ue:flex ue:h-7 ue:w-full ue:cursor-pointer ue:items-center ue:gap-1.5 ue:px-2.5 ue:text-left ue:text-body ue:text-fg ue:hover:bg-sel/60 ue:aria-[current=true]:bg-sel ue:aria-[current=true]:font-medium"
            >
              {i === 0 ? (
                <FileJson className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
              ) : (
                <FileSymlink className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent-text" />
              )}
              <span className="ue:min-w-0 ue:flex-1 ue:truncate">{f.split('/').pop()}</span>
              {i === 0 && <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{t('主文件')}</span>}
            </button>
          ))}
          <div className="ue:my-1 ue:border-t ue:border-line" />
        </>
      )}
      <div className="ue:flex ue:items-center ue:gap-1 ue:pr-1 ue:pl-2.5">
        <span className="ue:flex-1 ue:text-caption ue:text-subtle">{t('段')}</span>
        {sections.length > 1 && (
          <ui.IconButton
            icon={anyOpen ? ListCollapse : ListTree}
            size="sm"
            label={anyOpen ? t('全部折叠') : t('全部展开')}
            onClick={() => onFoldAll(anyOpen)}
          />
        )}
      </div>
      {sections.map((s) => {
        const closed = folded.has(s.id)
        const n = s.endLine - s.startLine + 1
        return (
          <div key={s.id} className="ue:group ue:flex ue:items-start ue:gap-1 ue:px-1 ue:hover:bg-sel/60">
            <button
              type="button"
              disabled={!s.contiguous}
              aria-label={closed ? t('展开') : t('折叠')}
              onClick={() => onFold(s.id)}
              className="ue:mt-1.5 ue:cursor-pointer ue:text-subtle ue:hover:text-fg ue:disabled:invisible"
            >
              <ChevronRight className={cn('ue:h-3 ue:w-3 ue:transition-transform', !closed && 'ue:rotate-90')} />
            </button>
            <button
              type="button"
              onClick={() => onJump(s.startLine)}
              title={s.contiguous ? undefined : t('头部字段被别的段隔开了：保存一次整份配置会按顺序排好')}
              className="ue:flex ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:flex-col ue:py-1 ue:text-left"
            >
              <span className="ue:flex ue:min-w-0 ue:items-baseline ue:gap-1.5">
                <span className="ue:truncate ue:text-body ue:text-fg">{sectionLabel(s.id, kind)}</span>
                {/* 段名照写（头段是 header）：和 ue_forge 的 section 参数、schema 的 x-forge.sections 对得上 */}
                <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{s.id}</span>
              </span>
              <span className="ue:text-caption ue:text-subtle">
                {t('{n} 行 · {a}–{b}', { n, a: s.startLine, b: s.endLine })}
                {!s.contiguous && <span className="ue:ml-1 ue:text-warning">{t('顺序不对')}</span>}
              </span>
            </button>
            {s.include && (
              <button
                type="button"
                title={t('整段在片段文件 {f} 里：点一下打开', { f: s.include })}
                onClick={() => onInclude(s.include!)}
                className="ue:mt-1 ue:shrink-0 ue:cursor-pointer ue:rounded ue:p-0.5 ue:text-accent-text ue:hover:bg-accent/15"
              >
                <FileSymlink className="ue:h-3.5 ue:w-3.5" />
              </button>
            )}
            {onEditSection && s.contiguous && (
              <button
                type="button"
                title={t('只编辑这一段')}
                aria-label={t('只编辑这一段')}
                onClick={() => onEditSection(s.id)}
                className="ue:mt-1 ue:shrink-0 ue:cursor-pointer ue:rounded ue:p-0.5 ue:text-subtle ue:opacity-0 ue:group-hover:opacity-100 ue:hover:bg-sel ue:hover:text-fg ue:focus-visible:opacity-100"
              >
                <Pencil className="ue:h-3.5 ue:w-3.5" />
              </button>
            )}
          </div>
        )
      })}
      {!sections.length && (
        <p className="ue:px-2.5 ue:py-1 ue:text-caption ue:text-subtle">{t('读不懂这份文件，分不出段')}</p>
      )}
    </nav>
  )
}
