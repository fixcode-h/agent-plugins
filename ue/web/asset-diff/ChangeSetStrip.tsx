import { ChevronDown, ChevronRight, FileStack, GitMerge } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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

/**
 * 「#1221205 里一起改的资源」（设计稿「UE资源版本差异-修复与强化」3.5）：选中某一版时挂在头部下面，
 * 点开这一版才查（服务端 asset-diff/changeset.ts），点一个资源切过去，停在同一版。
 * 平时只占一行摘要：个数、主要是哪几类、是不是整批合并 / 拷贝进来的（用户 2026-11-25：一次 merge 带进 491 个资源，
 * 平铺成标签墙把差异挤没了）；展开后是限高、可搜、可分组的列表（ChangeSetList）。
 * 设置 → 组件「版本差异」选了默认展开时，也只有十几个以内才自动展开
 */
export function ChangeSetStrip({
  pkg,
  change,
  label,
  rev,
  message,
}: {
  pkg: string
  change: string
  label: string
  rev: string
  message: string
}) {
  const { project } = useUe()
  const { cn } = h()
  const { sameCommitOpen } = useDiffPrefs()
  const [open, setOpen] = useState<boolean | null>(null)
  const [got, setGot] = useState<Got | null>(null)
  useEffect(() => {
    let live = true
    setGot(null)
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
  if (!got || got.change !== change) return null
  // 只改了这一个资源：不占地方
  if (!items.length && !got.error) return null
  const shown = open ?? (sameCommitOpen && items.length <= OPEN_MAX)
  const bulk = bulkKind(message)
  const spread = typeSpread(items, (a) => a.cls, 3)
  const Chevron = shown ? ChevronDown : ChevronRight
  return (
    <div className="ue:shrink-0 ue:border-b ue:border-line ue:px-3 ue:py-1.5 ue:text-footnote">
      {got.error ? (
        <div className="ue:flex ue:items-center ue:gap-1.5 ue:text-muted">
          <FileStack className="ue:h-3.5 ue:w-3.5" />
          {t('查不到 {rev} 里还改了哪些文件：{msg}', { rev: label, msg: got.error })}
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={shown}
          onClick={() => setOpen(!shown)}
          className="ue:flex ue:w-full ue:min-w-0 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:text-muted ue:hover:text-fg"
        >
          <Chevron className="ue:h-3 ue:w-3 ue:shrink-0" />
          <FileStack className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
          <span className="ue:shrink-0 ue:whitespace-nowrap">
            {t('{rev} 里一起改的资源（{n}）', { rev: label, n: items.length })}
          </span>
          {bulk && (
            <span
              title={t('整批合并 / 拷贝进来的提交：一起进来的资源多半只是跟着分支过来，不一定和这个资源的改动有关')}
              className={cn(
                'ue:inline-flex ue:shrink-0 ue:items-center ue:gap-1 ue:rounded-(--c-badge-radius) ue:bg-sel ue:px-1.5 ue:text-caption ue:text-fg',
              )}
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
      {shown && items.length > 0 && (
        <>
          {bulk && items.length > OPEN_MAX && (
            <div className="ue:mt-1 ue:text-caption ue:text-subtle">
              {t('这是一次整批合并 / 拷贝的提交，下面的资源多半只是跟着分支过来，不一定和这个资源的改动有关。')}
            </div>
          )}
          <ChangeSetList items={items} onOpen={(p) => openAssetDiff(p, rev)} />
        </>
      )}
    </div>
  )
}
