import { Box, Crosshair } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { GtPropItem, GtPropKind } from '../../../../../shared/gt-script/index.ts'
import { Details } from '../../../../details/Details.tsx'
import type { DetailsApi, Node } from '../../../../details/rows.tsx'
import { h, t } from '../../../../host.ts'
import { tabOf, toDetailProps, type DetailTab } from './data.ts'

/** gt.props 截过的长字符串（C++ 截成前 200 字再加「…」，GameTestRpcProps.cpp MaxValueChars） */
export const TRUNCATED_AT = 200
export const isTruncated = (v: unknown): v is string =>
  typeof v === 'string' && v.length > TRUNCATED_AT && v.endsWith('…')

/** 展开结构体、数组后的子行没有 kind：按此刻的值粗推（比较时按它挑 op） */
export function kindOfValue(v: unknown): GtPropKind | undefined {
  if (typeof v === 'boolean') return 'bool'
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float'
  if (typeof v === 'string') return 'string'
  if (Array.isArray(v)) return 'array'
  return undefined
}

const TABS: { id: DetailTab; label: () => string }[] = [
  { id: 'props', label: () => t('属性') },
  { id: 'fns', label: () => t('方法') },
  { id: 'lua', label: () => t('Lua') },
  { id: 'states', label: () => t('运行状态') },
]

/**
 * 第 3 栏「细节」：复用 AssetForge 的细节面板（details/Details.tsx），上面 Segmented 分「属性 · 方法 · Lua · 运行状态」，
 * 属性按 UE 的 Category 分组。值只看不改；行尾的准星把这一项加进唯一标识组（再点一下拿掉）。
 * 结构体、数组本身不能直接比，展开后对里面的成员点准星
 */
export function DetailPane({
  items,
  loading,
  error,
  note,
  siblings,
  groupTitle,
  picked,
  onPick,
  noClass,
}: {
  items: GtPropItem[]
  loading?: boolean
  error?: string
  /** UE 读不到、只给了 Lua 声明这类说明 */
  note?: string
  siblings?: number
  groupTitle: (it: GtPropItem) => string
  /** 已经在标识组里的路径 */
  picked: Set<string>
  onPick: (prop: string, kind: GtPropKind | undefined, value: unknown, item?: GtPropItem) => void
  noClass?: boolean
}) {
  const { ui, cn } = h()
  const [tab, setTab] = useState<DetailTab>('props')
  const byTab = useMemo(() => {
    const m: Record<DetailTab, GtPropItem[]> = { props: [], fns: [], lua: [], states: [] }
    for (const it of items) m[tabOf(it)].push(it)
    return m
  }, [items])
  const cur = byTab[tab].length || !items.length ? tab : (TABS.find((x) => byTab[x.id].length)?.id ?? tab)
  const props = useMemo(() => toDetailProps(byTab[cur], groupTitle, siblings), [byTab, cur, groupTitle, siblings])
  const byProp = useMemo(() => new Map(items.map((x) => [x.prop, x])), [items])

  if (noClass)
    return (
      <div className="ue:flex ue:flex-1 ue:flex-col ue:items-center ue:justify-center ue:gap-2 ue:p-6 ue:text-center">
        <Box className="ue:h-8 ue:w-8 ue:text-subtle" />
        <span className="ue:text-body ue:font-medium ue:text-fg">{t('先定类')}</span>
        <span className="ue:max-w-md ue:text-footnote ue:text-subtle">
          {t(
            '在顶上的类下拉里从类树挑（可以搜），或者在左边双击一个界面、右键「选这个类」。定了类，这里列出它的属性，点行尾的准星加进唯一标识组。',
          )}
        </span>
      </div>
    )

  const api: Omit<DetailsApi, 'q'> = {
    busy: '',
    version: 0,
    changed: () => undefined,
    isChanged: () => false,
    setValue: () => undefined,
    arrayOp: () => undefined,
    reset: () => undefined,
    openRef: () => undefined,
    // gt.props 不截结构体、数组（整个给），只把超过 200 字的字符串截成「前 200 字…」，也没有按路径取完整值的操作：
    // 展开时给的就是列表里的值；截过的字符串照原样显示省略号
    loadFull: async (path: string) => byProp.get(path)?.value,
    action: (n: Node) => {
      const item = byProp.get(n.path)
      const v = n.value
      // 结构体、数组本身不能直接比（UE 标了 comparable: false 的也一样），展开后比成员
      const structy = v !== null && typeof v === 'object' && !Array.isArray(v)
      if (structy || item?.comparable === false) return null
      const on = picked.has(n.path)
      return (
        <button
          type="button"
          aria-pressed={on}
          aria-label={on ? t('移出标识组') : t('加进唯一标识组')}
          title={on ? t('移出标识组') : t('加进唯一标识组')}
          onClick={(e) => {
            e.stopPropagation()
            onPick(n.path, item?.kind ?? kindOfValue(v), v, item)
          }}
          className={cn(
            'ue:flex ue:h-6 ue:w-6 ue:cursor-pointer ue:items-center ue:justify-center ue:rounded-md',
            on ? 'ue:bg-accent ue:text-on-accent' : 'ue:text-subtle ue:hover:bg-hover ue:hover:text-fg',
          )}
        >
          <Crosshair className="ue:h-3.5 ue:w-3.5" />
        </button>
      )
    },
  }

  return (
    <>
      <div className="ue:flex ue:items-center ue:gap-3 ue:border-b ue:border-line ue:px-3 ue:py-2">
        <ui.Segmented
          size="sm"
          label={t('属性 / 方法 / Lua / 运行状态')}
          value={cur}
          onChange={(v: DetailTab) => setTab(v)}
          options={TABS.map((x) => ({ id: x.id, label: `${x.label()} ${byTab[x.id].length}` }))}
        />
      </div>
      {error && <p className="ue:px-3 ue:py-2 ue:text-footnote ue:text-danger">{error}</p>}
      {note && <p className="ue:px-3 ue:py-1.5 ue:text-caption ue:text-warning">{note}</p>}
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-auto">
        {!loading && !error && !props.length ? (
          <p className="ue:px-3 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">{t('这一页没有可看的项')}</p>
        ) : (
          <Details props={props} api={api} loading={loading} />
        )}
      </div>
    </>
  )
}
