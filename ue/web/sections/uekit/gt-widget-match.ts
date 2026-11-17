import { matchRows, queryTerms, type AssetRow, type LoadedIndex } from '../../jump/index-match.ts'

/**
 * 运行设置「阻挡界面」输入框的候选（用户 2026-11-17：WBP 输入框要能下拉搜索）：从跳转弹窗同一份本地索引里挑出控件蓝图，
 * 打字只在网页里筛，不发请求、不碰 UE。不依赖 React，单测直接跑
 */

export interface WidgetHit {
  /** 选中后填进框里的值：名字不重复时填类名（WBP_Notice），重名时填包路径（/Game/UI/WBP_Notice），GameTest 两种都认 */
  value: string
  name: string
  /** 包路径 /Game/UI/WBP_Notice */
  pkg: string
  /** 索引认出了是控件蓝图；false 是按名字猜的（扫磁盘时没有类名） */
  sure: boolean
}

/** 名字像界面的前缀：扫磁盘的索引不知道类名，只能按命名习惯猜 */
const WIDGET_NAME = /^(wbp|wb|w|ui|umg)_/

/**
 * 是不是可能当阻挡界面的控件蓝图：
 * - 索引认出是 WidgetBlueprint 的（编辑器工具控件不会在游戏里弹，不列）；
 * - UEToVS 只按父类猜类型，父类是项目自己的控件基类（名字不以 UserWidget 结尾）时会记成 Blueprint，父类名里有 Widget 的也算；
 * - 扫磁盘时类名是空串，名字是 WBP_ / W_ / UI_ 开头的也列出来
 */
export function widgetKind(r: AssetRow): 'sure' | 'guess' | undefined {
  if (r.cls === 'WidgetBlueprint') return 'sure'
  if (r.cls !== 'Blueprint' && r.cls !== '') return undefined
  if (r.parent && /widget/i.test(r.parent) && !/EditorUtility/i.test(r.parent)) return 'sure'
  return WIDGET_NAME.test(r.lname) ? 'guess' : undefined
}

/** 每份索引只挑一次候选：5000+ 资源时每次按键只在控件蓝图里筛 */
const pool = new WeakMap<LoadedIndex, { rows: AssetRow[]; sure: Set<AssetRow>; dup: Set<string> }>()

function widgets(idx: LoadedIndex) {
  let p = pool.get(idx)
  if (p) return p
  const rows: AssetRow[] = []
  const sure = new Set<AssetRow>()
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const r of idx.assets) {
    const k = widgetKind(r)
    if (!k) continue
    rows.push(r)
    if (k === 'sure') sure.add(r)
    if (seen.has(r.lname)) dup.add(r.lname)
    seen.add(r.lname)
  }
  // 空查询时按名字列：认出来的在前
  rows.sort((a, b) => Number(sure.has(b)) - Number(sure.has(a)) || (a.lname < b.lname ? -1 : a.lname > b.lname ? 1 : 0))
  p = { rows, sure, dup }
  pool.set(idx, p)
  return p
}

/** 包路径：对象路径去掉 .Name */
const pkgOf = (r: AssetRow) => r.path.split('.')[0]

/** 按输入筛控件蓝图；空输入列前 limit 个。total 是一共匹配到几个 */
export function matchWidgets(idx: LoadedIndex | undefined, q: string, limit: number) {
  if (!idx) return { rows: [] as WidgetHit[], total: 0, all: 0 }
  const p = widgets(idx)
  const terms = queryTerms(q)
  const hit = terms.length
    ? matchRows(p.rows, terms, (r) => [r.lname, r.lpath], limit)
    : { rows: p.rows.slice(0, limit), total: p.rows.length }
  return {
    rows: hit.rows.map((r) => ({
      value: p.dup.has(r.lname) ? pkgOf(r) : r.name,
      name: r.name,
      pkg: pkgOf(r),
      sure: p.sure.has(r),
    })),
    total: hit.total,
    all: p.rows.length,
  }
}
