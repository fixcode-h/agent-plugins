import { ChevronDown, ChevronRight, FileStack } from 'lucide-react'
import { useEffect, useState } from 'react'
import { pget } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { useDiffPrefs } from './prefs.ts'
import { openAssetDiff } from './store.ts'

/**
 * 「#1221205 里一起改的资源（4）」（设计稿「UE资源版本差异-修复与强化」3.5）：选中某一版时挂在头部下面，
 * 点开这一版才查（服务端 asset-diff/changeset.ts），点一个资源切过去，停在同一版。默认展开还是收起在设置 → 组件「版本差异」
 */
export function ChangeSetStrip({ pkg, change, label, rev }: { pkg: string; change: string; label: string; rev: string }) {
  const { project } = useUe()
  const { cn } = h()
  const { sameCommitOpen } = useDiffPrefs()
  const [open, setOpen] = useState(sameCommitOpen)
  const [got, setGot] = useState<{ change: string; assets: string[]; others: number; error?: string } | null>(null)
  useEffect(() => {
    let live = true
    setGot(null)
    pget<{ assets: string[]; others: number }>(project.id, `asset-diff/changeset?change=${encodeURIComponent(change)}`).then(
      (r) => live && setGot({ change, ...r }),
      (e: Error) => live && setGot({ change, assets: [], others: 0, error: e.message }),
    )
    return () => {
      live = false
    }
  }, [project.id, change])
  if (!got || got.change !== change) return null
  const others = got.assets.filter((a) => a !== pkg)
  // 只改了这一个资源：不占地方
  if (!others.length && !got.error) return null
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="ue:shrink-0 ue:border-b ue:border-line ue:px-3 ue:py-1.5 ue:text-footnote">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1.5 ue:text-muted ue:hover:text-fg"
      >
        <Chevron className="ue:h-3 ue:w-3" />
        <FileStack className="ue:h-3.5 ue:w-3.5" />
        {got.error
          ? t('查不到 {rev} 里还改了哪些文件：{msg}', { rev: label, msg: got.error })
          : t('{rev} 里一起改的资源（{n}）', { rev: label, n: others.length })}
        {got.others > 0 && !got.error && (
          <span className="ue:text-caption ue:text-subtle">{t('另有 {n} 个其他文件', { n: got.others })}</span>
        )}
      </button>
      {open && others.length > 0 && (
        <div className="ue:mt-1.5 ue:flex ue:flex-wrap ue:gap-1.5">
          {others.map((a) => (
            <button
              key={a}
              type="button"
              title={t('看 {p} 在这一版的差异', { p: a })}
              onClick={() => openAssetDiff(a, rev)}
              className={cn(
                'ue:inline-flex ue:h-6 ue:max-w-72 ue:cursor-pointer ue:items-center ue:rounded-(--c-badge-radius) ue:bg-sel ue:px-2 ue:font-mono ue:text-caption ue:text-fg ue:hover:bg-hover',
              )}
            >
              <span className="ue:truncate">{a.split('/').pop()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
