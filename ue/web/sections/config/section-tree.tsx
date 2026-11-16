import { FileCog, Folder as FolderIcon, FolderOpen } from 'lucide-react'
import { t } from '../../host.ts'
import type { TreeLine } from '../../TreeList.tsx'
import { Hit, keepSet } from '../../tree-search.tsx'

export interface Sec {
  name: string
  layers: string[]
  liveOnly?: boolean
}

/** 树上的一个节点：路径上的一段；sec 有值说明这一段本身也是一个 section（如 Core 和 Core.Log 都有） */
interface Node {
  key: string
  name: string
  sec?: Sec
  kids: Node[]
  /** 下面（含自己）有几个 section，文件夹行尾显示 */
  count: number
}

/**
 * section 名拆成路径：「/Script/Engine.Actor」→ /Script、Engine、Actor（照 UE 的「/挂载点/模块.类」），
 * 「Core.Log」这类不带斜杠的按「.」拆（只拆第一个，后面的点常是名字的一部分）
 */
export function secPath(name: string): string[] {
  if (name.startsWith('/')) {
    const segs = name.split('/').filter(Boolean)
    if (!segs.length) return [name]
    const last = segs.pop() as string
    const dot = last.indexOf('.')
    const tail = dot > 0 ? [last.slice(0, dot), last.slice(dot + 1)] : [last]
    return segs.length ? [`/${segs[0]}`, ...segs.slice(1), ...tail] : [`/${tail[0]}`, ...tail.slice(1)]
  }
  const dot = name.indexOf('.')
  return dot > 0 ? [name.slice(0, dot), name.slice(dot + 1)] : [name]
}

/** 每一层的 key 用路径拼起来（不用 section 原名，免得 Core 的 section 和 Core 文件夹撞 key） */
const keyOf = (path: string[]) => path.join('\u0001')

/**
 * 拼成树；只有一个 section 的模块收成一行「AIModule.AISystem」（像 VS Code 的紧凑文件夹），
 * 不然 /Script 下面一大半模块都得多点一层才看得到唯一的那个类
 */
export function buildSecTree(secs: Sec[]): Node[] {
  const root: Node = { key: '', name: '', kids: [], count: 0 }
  for (const s of secs) {
    const path = secPath(s.name)
    let cur = root
    path.forEach((p, i) => {
      let next = cur.kids.find((k) => k.name === p)
      if (!next) {
        next = { key: keyOf(path.slice(0, i + 1)), name: p, kids: [], count: 0 }
        cur.kids.push(next)
      }
      cur = next
    })
    cur.sec = s
  }
  const fin = (n: Node): Node => {
    n.kids = n.kids.map(fin)
    // 挂载点（/Script 这种带斜杠的）不收，收了树就没有骨架了
    if (n.key && !n.name.startsWith('/') && !n.sec && n.kids.length === 1 && !n.kids[0].kids.length) {
      const only = n.kids[0]
      return { ...only, name: `${n.name}.${only.name}`, count: 1 }
    }
    n.count = (n.sec ? 1 : 0) + n.kids.reduce((a, k) => a + k.count, 0)
    // 文件夹在前、section 在后，各自按名字排（和资源页文件夹树一样）
    n.kids.sort((a, b) => Number(!a.kids.length) - Number(!b.kids.length) || a.name.localeCompare(b.name))
    return n
  }
  return fin(root).kids
}

/** 选中的 section 一路上的文件夹 key（从搜索结果跳过来时展开到它） */
export function ancestorsOf(name: string): string[] {
  const path = secPath(name)
  return path.slice(1).map((_, i) => keyOf(path.slice(0, i + 1)))
}

/** 根据 section 名找它在树上那一行的 key（紧凑行的 key 是最深那一段的） */
export function lineKeyOf(name: string) {
  return keyOf(secPath(name))
}

export interface SecLinesCtx {
  tree: Node[]
  /** 筛选关键词：按 section 全名筛（不分大小写） */
  q: string
  open: string[]
  /** 筛选时自动展开的文件夹被用户手动收起的 */
  folded: Record<string, boolean>
  section: string
  toggle: (key: string) => void
  fold: (key: string, wasOpen: boolean) => void
  pick: (name: string) => void
}

/** 按展开状态摊成 TreeList 的行；筛选时只留命中的和它们的上级，并自动展开 */
export function secLines(c: SecLinesCtx) {
  const q = c.q.trim().toLowerCase()
  const { keep, hits } = q
    ? keepSet(
        c.tree,
        (n) => n.kids,
        (n) => n.key,
        (n) => !!n.sec && n.sec.name.toLowerCase().includes(q),
      )
    : { keep: new Set<string>(), hits: 0 }
  const out: TreeLine[] = []
  const walk = (list: Node[], depth: number) => {
    for (const n of list) {
      if (q && !keep.has(n.key)) continue
      const expandable = n.kids.length > 0
      const forced = !!q && n.kids.some((k) => keep.has(k.key))
      const isOpen = forced ? !c.folded[n.key] : c.open.includes(n.key)
      const s = n.sec
      out.push({
        key: n.key,
        depth,
        label: q ? <Hit text={n.name} q={c.q} /> : n.name,
        icon: expandable ? (isOpen ? FolderOpen : FolderIcon) : FileCog,
        iconTone: expandable ? 'ue:text-subtle' : undefined,
        expandable,
        open: isOpen,
        selected: !!s && s.name === c.section,
        title: s
          ? s.liveOnly
            ? `${s.name}\n${t('只在进程里有（插件的 Config 或运行中加的）')}`
            : `${s.name}\n${s.layers.join('\n')}`
          : undefined,
        // 文件夹显示下面有几个 section；section 显示写在几层 ini 里
        aside: expandable ? n.count : s?.liveOnly ? t('进程') : s?.layers.length,
        onToggle: forced ? () => c.fold(n.key, isOpen) : () => c.toggle(n.key),
        onSelect: s ? () => c.pick(s.name) : undefined,
        // 纯文件夹单击就展开收起；本身也是 section 的单击选中、双击展开
        clickToggles: !s,
      })
      if (expandable && isOpen) walk(n.kids, depth + 1)
    }
  }
  walk(c.tree, 0)
  return { lines: out, hits }
}
