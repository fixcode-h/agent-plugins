import { assetIcon } from '../../../asset-icons.ts'
import { t } from '../../../host.ts'
import { useSearchIndex } from '../../../jump/index-data.ts'
import type { AssetRow, LoadedIndex } from '../../../jump/index-match.ts'
import { SuggestInput, type SuggestRow } from '../../../SuggestInput.tsx'

const LIMIT = 60

/** 每份索引只挑一次蓝图类（5000+ 资源时每次按键只在蓝图里筛） */
const pool = new WeakMap<LoadedIndex, AssetRow[]>()
function blueprints(idx: LoadedIndex) {
  let rows = pool.get(idx)
  if (rows) return rows
  const disk = idx.source.assets === 'disk'
  // 只认蓝图类（类名以 Blueprint 结尾：控件、Actor、动画、项目自己的蓝图子类型）；扫磁盘的索引认不出类型，全列
  rows = idx.assets.filter((r) => /Blueprint$/.test(r.cls) || (disk && r.cls === ''))
  rows.sort((a, b) => (a.lname < b.lname ? -1 : a.lname > b.lname ? 1 : 0))
  pool.set(idx, rows)
  return rows
}

/**
 * 按输入筛蓝图类：名字以输入开头的排前面（用户 2026-11-20：类名要前缀匹配），其次名字里带、路径里带的。
 * 输入可以带 U/A 前缀和 _C 后缀（GameTest 都认），筛的时候去掉
 */
export function matchClasses(idx: LoadedIndex | undefined, q: string, limit = LIMIT) {
  if (!idx) return { rows: [] as AssetRow[], total: 0 }
  const all = blueprints(idx)
  const k = q.trim().toLowerCase().replace(/_c$/, '')
  if (!k) return { rows: all.slice(0, limit), total: all.length }
  const head: AssetRow[] = []
  const mid: AssetRow[] = []
  for (const r of all) {
    if (r.lname.startsWith(k)) head.push(r)
    else if (r.lname.includes(k) || r.lpath.includes(k)) mid.push(r)
  }
  const hit = [...head, ...mid]
  return { rows: hit.slice(0, limit), total: hit.length }
}

/** 引用的「类」输入框：能直接填（C++ 类、索引里没有的），也能从项目蓝图里按前缀挑 */
export function ClassInput({
  project,
  value,
  onChange,
  onCommit,
  className,
}: {
  project: string
  value: string
  onChange: (v: string) => void
  /** 选中候选或失焦时：调用方按新类重新读属性 */
  onCommit?: (v: string) => void
  className?: string
}) {
  const index = useSearchIndex(project)
  const suggest = (q: string) => {
    const m = matchClasses(index.idx, q)
    const rows: SuggestRow[] = m.rows.map((r) => ({
      key: r.path,
      value: r.name,
      label: r.name,
      detail: r.dir,
      ...assetIcon(r.cls),
    }))
    return { rows, total: m.total }
  }
  return (
    <div className={className} onBlur={() => onCommit?.(value)}>
      <SuggestInput
        value={value}
        onChange={(v) => {
          onChange(v)
          // 从下拉里挑的（和某个候选同名）马上按它读，手打的等失焦
          if (matchClasses(index.idx, v, 1).rows[0]?.name === v) onCommit?.(v)
        }}
        suggest={suggest}
        inputClassName="ue:font-mono"
        placeholder="WBP_Shop"
        empty={t('索引里没有蓝图类，可以直接填类名（C++ 类也行）')}
        status={
          index.error
            ? t('读索引失败：{e}', { e: index.error })
            : !index.idx
              ? t('正在读项目索引…')
              : t('项目里的蓝图类，按名字开头匹配；C++ 类直接填')
        }
      />
    </div>
  )
}
