import { Box, RefreshCw } from 'lucide-react'
import { useRef, useState } from 'react'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useNavHistory } from '../../inspect/history.ts'
import { Inspector } from '../../inspect/Inspector.tsx'
import { splitSub } from '../../inspect/nav-state.ts'
import { PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '../../split.tsx'
import { Card, NotRunning, PageHead, useTargetInfo } from '../../ui.tsx'
import { Browse } from './Browse.tsx'

/**
 * 对象页（设计稿第 4 节，用户 2026-11-15 定名「对象」）：原来的 Actor 页和 Object 页合成一页。
 * 左边浏览栏（大纲 / UObject 树 / 按类搜 + 固定的对象），右边检视区（inspect/Inspector.tsx，和资源页同一个）：
 * 点属性里的引用就在这里往下看，资源会标成「资源」，后退前进、面包屑、最近看过和资源页共用一份历史
 */
export function Objects() {
  const { sub } = useUe()
  const { inst } = useTargetInfo()
  const { ui } = h()
  const nav = useNavHistory()
  const { path } = splitSub(sub)
  // 「刷新」也让大纲、UObject 树重读；检视区按 key 重挂载重读
  const [tick, setTick] = useState(0)
  const pane = usePane('objects', '26%', 220)
  const ref = useRef<HTMLElement>(null)
  // 检视区在看的是点引用过去的：引用链的起点（浏览栏里点的那个）在大纲里标「from」
  const start = nav.current?.path === path && nav.current.via ? nav.chain[0]?.entry : undefined

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead
        title={t('对象')}
        desc={t('世界里的 Actor 和 UObject；点属性里的引用就在这里往下看，资源会标成「资源」')}
      >
        <ui.Button size="sm" variant="secondary" onClick={() => setTick((n) => n + 1)}>
          <RefreshCw className="ue:h-3.5 ue:w-3.5" /> {t('刷新')}
        </ui.Button>
      </PageHead>
      {!inst ? (
        <NotRunning icon={Box} what={t('对象要在运行中的编辑器或游戏里找；资源在「资源」里看。')} />
      ) : (
        <div className={SPLIT_ROW}>
          <Card
            ref={ref}
            className={PANE_FIXED}
            style={pane.style('calc(100% - 600px)')}
            bodyClass="ue:flex ue:min-h-0 ue:flex-col"
          >
            <Browse
              tick={tick}
              selected={path}
              from={start?.page === 'objects' ? start.path : undefined}
              onOpen={(p, from) => nav.open('objects', p, { from })}
            />
          </Card>
          <SplitHandle pane={pane} paneRef={ref} reserve={() => 600} />
          <Inspector key={tick} page="objects" empty={t('在左边选一个对象，在这里看和改属性')} />
        </div>
      )}
    </div>
  )
}
