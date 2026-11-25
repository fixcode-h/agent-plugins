import { ChevronDown, ChevronRight, FileStack, GitMerge, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import * as vd from '@panel/web/src/components/ui/version-diff'
import { bulkKind, OPEN_MAX, typeSpread, type ChangeAsset } from '../../shared/asset-diff/changeset.ts'
import { pget } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { guessClass } from '../inspect/layouts/pick.ts'
import { assetClassLabel } from '../asset-icons.ts'
import { ChangeSetList } from './ChangeSetList.tsx'
import { useDiffPrefs } from './prefs.ts'
import { openAssetDiff } from './store.ts'

interface Got {
  change: string
  assets: string[]
  others: number
  /** 包路径 → 类（服务端查本地索引；旧服务端没有） */
  classes?: Record<string, string>
  /** 面板一次最多列这么多个文件，这次列满了：可能还有没列出来的 */
  truncated?: number
  error?: string
}

/** 面板的版本差异弹窗认不认左栏下面挂东西（旧面板没有就照旧展开在右边） */
const SIDE_OK = !!(vd as Record<string, unknown>).VERSION_DIFF_NAV_EXTRA

/** 点开某一版才查这一版还改了哪些资源（服务端 asset-diff/changeset.ts）；change 为空（本地改动）不查 */
function useChangeSet(pkg: string, change: string | undefined) {
  const { project } = useUe()
  const [got, setGot] = useState<Got | null>(null)
  useEffect(() => {
    let live = true
    setGot(null)
    if (!change) return
    pget<Omit<Got, 'change'>>(project.id, `asset-diff/changeset?change=${encodeURIComponent(change)}`).then(
      (r) => live && setGot({ change, ...r }),
      (e: Error) => live && setGot({ change, assets: [], others: 0, error: e.message }),
    )
    return () => {
      live = false
    }
  }, [project.id, change])
  const items: ChangeAsset[] = useMemo(
    () =>
      (got?.assets ?? [])
        .filter((a) => a !== pkg)
        .map((a) => ({ pkg: a, cls: got?.classes?.[a] || guessClass(a) || '' })),
    [got, pkg],
  )
  return got && got.change === change ? { got, items } : null
}

/**
 * 「#1221205 里一起改的资源」（设计稿「UE资源版本差异-修复与强化」3.5）：选中某一版时在右边头部下面占一行摘要：
 * 个数、主要是哪几类、是不是整批合并 / 拷贝进来的（用户 2026-11-25：一次 merge 带进 491 个资源，平铺成标签墙把差异挤没了）。
 * 点摘要展开可搜、可分组的列表（ChangeSetList），挂在左栏版本记录下面（用户 2026-11-25「点开放到左侧显示」：左栏很空，
 * 放右边会把差异往下挤）；旧面板左栏挂不了时展开在摘要下面。点一个资源切过去，停在同一版。
 * 展开收起跨版本记着；没点过时按设置 → 组件「版本差异」的默认，也只有十几个以内才自动展开。
 * 返回 strip（放右边）和 side（交给 VersionDiffShell 的 navExtra）
 */
export function useSameCommit(
  pkg: string,
  cur: { id: string; label: string; message: string; change?: string } | undefined,
): { strip: ReactNode; side: ReactNode } {
  const { cn } = h()
  const { sameCommitOpen } = useDiffPrefs()
  const [open, setOpen] = useState<boolean | null>(null)
  const cs = useChangeSet(pkg, cur?.change)
  if (!cur || !cs) return { strip: null, side: null }
  const { got, items } = cs
  // 只改了这一个资源：不占地方
  if (!items.length && !got.error) return { strip: null, side: null }
  const shown = !got.error && (open ?? (sameCommitOpen && items.length <= OPEN_MAX))
  const bulk = bulkKind(cur.message)
  const spread = typeSpread(items, (a) => a.cls, 3)
  const title = t('{rev} 里一起改的资源（{n}）', { rev: cur.label, n: items.length })
  const Chevron = shown ? ChevronDown : ChevronRight
  const bulkNote = bulk && items.length > OPEN_MAX && (
    <div className="ue:text-caption ue:text-subtle">
      {t('这是一次整批合并 / 拷贝的提交，下面的资源多半只是跟着分支过来，不一定和这个资源的改动有关。')}
    </div>
  )
  const list = (sideMode: boolean) => (
    <ChangeSetList
      items={items}
      onOpen={(p) => openAssetDiff(p, cur.id)}
      side={sideMode}
      head={
        sideMode && (
          <div className="ue:flex ue:flex-col ue:gap-1 ue:px-3 ue:pt-2">
            <div className="ue:flex ue:items-center ue:gap-1.5 ue:text-footnote ue:font-medium">
              <FileStack className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-muted" />
              <span className="ue:min-w-0 ue:flex-1 ue:truncate">{title}</span>
              <button
                type="button"
                aria-label={t('收起列表')}
                title={t('收起列表')}
                onClick={() => setOpen(false)}
                className="ue:flex ue:h-5 ue:w-5 ue:shrink-0 ue:cursor-pointer ue:items-center ue:justify-center ue:rounded-(--c-row-radius) ue:text-muted ue:hover:bg-hover ue:hover:text-fg"
              >
                <X className="ue:h-3.5 ue:w-3.5" />
              </button>
            </div>
            {bulkNote}
          </div>
        )
      }
    />
  )
  const strip = (
    <div className="ue:shrink-0 ue:border-b ue:border-line ue:px-3 ue:py-1.5 ue:text-footnote">
      {got.error ? (
        <div className="ue:flex ue:items-center ue:gap-1.5 ue:text-muted">
          <FileStack className="ue:h-3.5 ue:w-3.5" />
          {t('查不到 {rev} 里还改了哪些文件：{msg}', { rev: cur.label, msg: got.error })}
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={shown}
          title={shown ? t('收起列表') : SIDE_OK ? t('在左栏列出这些资源') : t('展开列表')}
          onClick={() => setOpen(!shown)}
          className="ue:flex ue:w-full ue:min-w-0 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:text-muted ue:hover:text-fg"
        >
          <Chevron className={cn('ue:h-3 ue:w-3 ue:shrink-0', SIDE_OK && shown && 'ue:text-accent-text')} />
          <FileStack className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
          <span className="ue:shrink-0 ue:whitespace-nowrap">{title}</span>
          {bulk && (
            <span
              title={t('整批合并 / 拷贝进来的提交：一起进来的资源多半只是跟着分支过来，不一定和这个资源的改动有关')}
              className="ue:inline-flex ue:shrink-0 ue:items-center ue:gap-1 ue:rounded-(--c-badge-radius) ue:bg-sel ue:px-1.5 ue:text-caption ue:text-fg"
            >
              <GitMerge className="ue:h-3 ue:w-3" />
              {bulk === 'copy' ? t('拷贝提交') : t('合并提交')}
            </span>
          )}
          {/* 类型分布：一眼看出这次主要改的是什么，不用展开 */}
          <span className="ue:min-w-0 ue:truncate ue:text-caption ue:text-subtle">
            {[
              ...spread.parts.map((p) => `${assetClassLabel(p.key)} ${p.n}`),
              ...(spread.rest ? [t('其他 {n}', { n: spread.rest })] : []),
              ...(got.others > 0 ? [t('另有 {n} 个其他文件', { n: got.others })] : []),
              ...(got.truncated ? [t('只列了前 {n} 个文件', { n: got.truncated })] : []),
            ].join(' · ')}
          </span>
        </button>
      )}
      {shown && !SIDE_OK && (
        <>
          {bulkNote && <div className="ue:mt-1">{bulkNote}</div>}
          {list(false)}
        </>
      )}
    </div>
  )
  return { strip, side: shown && SIDE_OK ? list(true) : null }
}
