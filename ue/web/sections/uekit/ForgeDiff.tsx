import { Copy } from 'lucide-react'
import { useState } from 'react'
import { h, t } from '../../host.ts'
import { copyText, openMenu } from '@panel/web/src/components/ui/item-menu'
import { ErrorBox, Hint, Loading } from './forge-parts.tsx'
import { sectionIds } from '../../../shared/forge-doc/sections.ts'
import { groupBySection } from './forge-config/diff-groups.ts'
import { sectionLabel } from './forge-config/section-label.ts'

/** forge.diff 的 diff（UEKit docs/asset-forge.md） */
export interface ForgeDiffData {
  supported: boolean
  reason?: string
  baseline?: 'asset' | 'config'
  changes: { property: string; before: unknown; after: unknown }[]
  total: number
  truncated?: boolean
}

export type Against = 'asset' | 'commit'

const show = (v: unknown) => (v === undefined || v === null ? '—' : typeof v === 'string' ? v : JSON.stringify(v))

/** 「对比：资产 / 上次提交的配置」下拉，放在页签那一行右边 */
export function AgainstSelect({ value, onChange }: { value: Against; onChange: (v: Against) => void }) {
  const { ui } = h()
  return (
    <ui.Select
      size="sm"
      className="ue:w-44"
      aria-label={t('和什么比')}
      value={value}
      onChange={(e: { target: { value: string } }) => onChange(e.target.value as Against)}
      options={[
        { value: 'asset', label: t('对比：资产') },
        { value: 'commit', label: t('对比：上次提交的配置') },
      ]}
    />
  )
}

/**
 * 「属性差异」页签：三列表格（属性 / 旧值 / 新值），上面一个按属性路径筛的输入框（差异是一次取回来的，
 * 本地筛，不发请求）。行右键复制属性路径、旧值、新值——查问题时最常做的是把这几个贴进对话。
 * 改动分在不止一段时按段分组（设计稿 4.3.3），每组前一行段名和条数。
 */

export function ForgeDiff({
  loading,
  error,
  diff,
  against,
  kind,
}: {
  loading: boolean
  error: string
  diff?: ForgeDiffData
  against: Against
  kind?: string
}) {
  const { ui } = h()
  const [q, setQ] = useState('')
  if (error) return <ErrorBox>{error}</ErrorBox>
  if (loading && !diff) return <Loading />
  if (!diff) return null
  if (!diff.supported) return <Hint>{diff.reason || t('这种资产不支持属性差异，看「导入计划」页')}</Hint>
  const key = q.trim().toLowerCase()
  const rows = key ? diff.changes.filter((c) => c.property.toLowerCase().includes(key)) : diff.changes
  const groups = groupBySection(rows, sectionIds(undefined, kind))
  const cell = 'ue:truncate ue:border-t ue:border-line/60 ue:px-3 ue:py-1.5'
  const head = 'ue:bg-sel/35 ue:px-3 ue:py-1.5 ue:font-sans ue:text-caption ue:text-subtle'
  const menu = (c: ForgeDiffData['changes'][number]) => (e: React.MouseEvent) =>
    openMenu(e, [
      { label: t('复制属性路径'), icon: Copy, onClick: () => copyText(c.property) },
      { label: t('复制旧值'), icon: Copy, onClick: () => copyText(show(c.before)) },
      { label: t('复制新值'), icon: Copy, onClick: () => copyText(show(c.after)) },
    ])
  return (
    <div className="ue:pb-4">
      {diff.changes.length > 0 && (
        <div className="ue:px-4 ue:py-2">
          <ui.Input
            size="sm"
            className="ue:w-full ue:max-w-80 ue:font-mono"
            placeholder={t('按属性路径筛')}
            value={q}
            onChange={(e: { target: { value: string } }) => setQ(e.target.value)}
          />
        </div>
      )}
      <div className="ue:grid ue:grid-cols-[minmax(200px,1.2fr)_1fr_1fr] ue:font-mono ue:text-footnote">
        <div className={head}>{t('属性')}</div>
        <div className={head}>{against === 'commit' ? t('上次提交的配置') : t('现在（资产）')}</div>
        <div className={head}>{against === 'commit' ? t('现在的配置') : t('导入后')}</div>
        {groups.map((g) => [
          groups.length > 1 && (
            <div
              key={`§${g.id}`}
              className="ue:col-span-3 ue:border-t ue:border-line ue:bg-sel/20 ue:px-3 ue:py-1 ue:font-sans ue:text-caption ue:font-medium ue:text-muted"
            >
              {sectionLabel(g.id, kind)} <span className="ue:font-normal ue:text-subtle">{g.rows.length}</span>
            </div>
          ),
          ...g.rows.map((c, i) => (
            <div key={`${g.id}-${i}`} className="ue:contents" onContextMenu={menu(c)}>
              <div className={`${cell} ue:text-fg`} title={c.property}>
                {c.property}
              </div>
              <div
                className={`${cell} ${c.before === undefined || c.before === null ? 'ue:text-subtle' : 'ue:bg-danger/8 ue:text-danger'}`}
                title={show(c.before)}
              >
                {show(c.before)}
              </div>
              <div className={`${cell} ue:bg-success/9 ue:text-success`} title={show(c.after)}>
                {show(c.after)}
              </div>
            </div>
          )),
        ])}
      </div>
      {!diff.changes.length && <Hint>{t('没有属性差异')}</Hint>}
      {diff.changes.length > 0 && !rows.length && <Hint>{t('没有符合的属性')}</Hint>}
      {diff.truncated && (
        <Hint>{t('差异太多，只列出了前 {n} 条（共 {total} 条）', { n: diff.changes.length, total: diff.total })}</Hint>
      )}
      {against === 'asset' && diff.changes.length > 0 && (
        <Hint>{t('对比可以换成「上次提交的配置」：从版本管理取旧版本，看这次改了哪些属性')}</Hint>
      )}
    </div>
  )
}
