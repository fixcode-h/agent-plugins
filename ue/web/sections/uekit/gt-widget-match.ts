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
  /** 索引认出了是控件蓝图；false 是认不出类型的（扫磁盘时没有类名） */
  sure: boolean
}

/**
 * 是不是可能当阻挡界面的控件蓝图。只按**继承**认，不按名字猜（用户 2026-11-18：所有 UMG 都直接或间接继承 UserWidget）：
 * - 索引认出是 WidgetBlueprint 的（服务端顺着原生父类和项目头文件的继承链认，见 server/search-index/native-widgets.ts）；
 *   编辑器工具控件不会在游戏里弹，不列；
 * - 扫磁盘的索引（`disk`）不读 .uasset，类名是空串、认不出是什么：也列出来但标成没认出（淡显、排在后面），打字筛。
 *   UEToVS 的索引里类名是空串的是不是蓝图的资源（数据表、贴图），不列
 */
export function widgetKind(r: AssetRow, disk = false): 'sure' | 'guess' | undefined {
  if (r.cls === 'WidgetBlueprint') return 'sure'
  return disk && r.cls === '' ? 'guess' : undefined
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
  const disk = idx.source.assets === 'disk'
  for (const r of idx.assets) {
    const k = widgetKind(r, disk)
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
