import { useEffect } from 'react'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import type { NavFrom } from '../../inspect/history.ts'
import { Pins } from '../../inspect/Pins.tsx'
import { keep, useKept } from '../../keep.ts'
import { setPending, takePending } from '../../pending.ts'
import { ObjectTree } from '../ObjectTree.tsx'
import { Outliner } from '../Outliner.tsx'
import { ClassSearch } from './ClassSearch.tsx'

export type BrowseTab = 'outline' | 'tree' | 'search'

const tabKey = (pid: string) => `${pid}/objects/browse`

/** 旧地址 actors/…、go('actors', p) 转到对象页时把浏览栏切到「大纲」（UePage 调） */
export function showOutline(pid: string) {
  keep(tabKey(pid), 'outline')
}

/**
 * 对象页的浏览栏（设计稿第 4 节）：三个页签——大纲（默认，世界里的 Actor）、UObject 树（按外层展开）、按类搜，
 * 底部「固定的对象」三个页签都显示。页签和各自的筛选词存在 keep.ts，切页面回来还在
 */
export function Browse({
  tick,
  selected,
  from,
  onOpen,
  docked = false,
}: {
  /** 整栏放在左边二级面板里（用户 2026-11-18 定：浏览方式和列表并到一起）：页签铺满宽度，不加分隔线 */
  docked?: boolean
  tick: number
  selected: string
  /** 检视区正在看的是从哪个 Actor 点引用过去的（大纲里标「from」） */
  from?: string
  onOpen: (path: string, from: NavFrom) => void
}) {
  const { project } = useUe()
  const { ui } = h()
  const [tab, setTab] = useKept<BrowseTab>(tabKey(project.id), 'outline')
  // Ctrl+K 带过来的类名 / 名字开头：切到「按类搜」，由它取走再搜（它没挂着时取不到）
  useEffect(() => {
    const p = takePending('objects')
    if (p) {
      setPending('objects', p)
      setTab('search')
    }
    // 只在进来时看一次
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <>
      <div className={docked ? '' : 'ue:border-b ue:border-line ue:px-3 ue:pt-3 ue:pb-2'}>
        <ui.Segmented
          size="sm"
          label={t('大纲 / UObject 树 / 按类搜')}
          value={tab}
          onChange={setTab}
          className={docked ? 'ue:w-full' : undefined}
          options={[
            { id: 'outline' as const, label: t('大纲') },
            { id: 'tree' as const, label: t('UObject 树') },
            { id: 'search' as const, label: t('按类搜') },
          ]}
        />
      </div>
      {tab === 'outline' ? (
        <Outliner tick={tick} selected={selected} from={from} onSelect={(p) => onOpen(p, 'outline')} />
      ) : tab === 'tree' ? (
        <ObjectTree tick={tick} selected={selected} onSelect={(p) => onOpen(p, 'tree')} />
      ) : (
        <ClassSearch selected={selected} onOpen={(p) => onOpen(p, 'search')} />
      )}
      <Pins selected={selected} onOpen={(p) => onOpen(p, 'pins')} />
    </>
  )
}
