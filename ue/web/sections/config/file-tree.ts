import { t } from '../../host.ts'
import { ancestorsOf, buildSecTree, lineKeyOf, type Node, type Sec } from './section-tree.tsx'

/** 读到的一层 ini：显示名（「引擎 BaseEngine」）和磁盘路径 */
export interface LayerInfo {
  label: string
  file: string
}

/** 左栏的分组方式：按 section 名（/Script/模块.类）或按定义它的 ini 文件（用户 2026-11-19「按照文件分树结构展示」） */
export type SecGroup = 'section' | 'file'

const LIVE = '\u0002live'
const fileKey = (label: string) => `\u0002${label}\u0002`

/**
 * 按文件分树：顶层是各层 ini，按加载顺序（Base → Default → 平台 → Saved，后面的盖前面的），
 * 每个文件下面是它写到的 section，照旧按「/Script/模块.类」分文件夹。
 * 同一个 section 被几个文件写到就在几个文件下面各出现一次，悬停看全部来源；只在进程里有的另放一组
 */
export function buildFileTree(secs: Sec[], layers: LayerInfo[]): Node[] {
  const out: Node[] = []
  for (const l of layers) {
    const mine = secs.filter((s) => s.layers.includes(l.label))
    if (!mine.length) continue
    const key = fileKey(l.label)
    out.push({ key, name: l.label, file: l.file, kids: buildSecTree(mine, key), count: mine.length })
  }
  const live = secs.filter((s) => s.liveOnly)
  if (live.length)
    out.push({
      key: LIVE,
      name: t('只在进程里（插件的 Config 或运行中加的）'),
      kids: buildSecTree(live, LIVE),
      count: live.length,
    })
  return out
}

/** section 在按文件分树里定位到哪个文件下面：最后写它的那层（最终值多半出自那里） */
function homeOf(sec: Sec) {
  return sec.liveOnly ? LIVE : fileKey(sec.layers.at(-1) ?? '')
}

/** 选中的 section 一路上要展开的 key（含所在的文件） */
export function fileAncestors(sec: Sec) {
  const home = homeOf(sec)
  return [home, ...ancestorsOf(sec.name, home)]
}

export function fileLineKey(sec: Sec) {
  return lineKeyOf(sec.name, homeOf(sec))
}
