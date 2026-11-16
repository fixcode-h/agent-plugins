import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useAssetSave } from '../../inspect/asset-save.tsx'
import { useNavHistory } from '../../inspect/history.ts'
import { Inspector } from '../../inspect/Inspector.tsx'
import { splitSub } from '../../inspect/nav-state.ts'
import { keep, useKept } from '../../keep.ts'
import { setPending, takePending } from '../../pending.ts'
import { PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '../../split.tsx'
import { Card, PageHead } from '../../ui.tsx'
import { MenuHost } from '../../menu.tsx'
import { AssetFolders } from './Folders.tsx'
import { AssetSearch } from './Search.tsx'

/**
 * 资源页（设计稿第 3、8 节）：和对象页同一套「浏览栏 + 检视区」布局，左边浏览栏两个页签——文件夹（默认，照 Content Browser
 * 点开才读下一层）和搜索（类型 + 名字前缀）；右边检视区和对象页是同一个组件、同一份导航历史。
 * 资源的改动只暂存在编辑器里，页头「保存」才写回（P4 先签出）；保存只放在这里，对象页里改的也在这里存
 */
export function Assets() {
  const { project, sub } = useUe()
  const { ui } = h()
  const nav = useNavHistory()
  const save = useAssetSave()
  const { path } = splitSub(sub)
  const kk = `${project.id}/assets`
  // Ctrl+K 带过来的名字、路径：切到「搜索」，由它取走再搜（lazy 初始值只看一次，切回来不会再切）
  useState(() => {
    const p = takePending('assets')
    if (p) {
      setPending('assets', p)
      keep(`${kk}/browse`, 'search')
    }
  })
  const [tab, setTab] = useKept<'folders' | 'search'>(`${kk}/browse`, 'folders')
  // 要在文件夹树里定位的资源：「在文件夹里定位」、从别处（对象页点引用、Ctrl+K、对话）跳过来的
  const [reveal, setReveal] = useKept<string | undefined>(`${kk}/reveal`, undefined)
  const [tick, setTick] = useState(0)
  const pane = usePane('assets', '26%', 220)
  const ref = useRef<HTMLElement>(null)

  // 不是在文件夹树里点的（点引用、后退前进、别处跳过来）：树展开到它所在的文件夹并选中
  const cur = nav.current?.path === path ? nav.current : undefined
  useEffect(() => {
    if (path && cur && cur.from !== 'folders') setReveal(path)
    // 只在换了资源时看
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [path, cur?.from])

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title={t('资源')} desc={t('编辑器没开时自动起后台编辑器读取；改动点「保存」才写回文件')}>
        {save.head}
        <ui.Button
          size="sm"
          variant="secondary"
          onClick={() => {
            save.reload()
            setTick((n) => n + 1)
          }}
        >
          <RefreshCw className="ue:h-3.5 ue:w-3.5" /> {t('刷新')}
        </ui.Button>
      </PageHead>
      <div className={SPLIT_ROW}>
        <Card
          ref={ref}
          className={PANE_FIXED}
          style={pane.style('calc(100% - 600px)')}
          bodyClass="ue:flex ue:min-h-0 ue:flex-col"
        >
          <div className="ue:border-b ue:border-line ue:px-3 ue:pt-3 ue:pb-2">
            <ui.Segmented
              size="sm"
              label={t('文件夹 / 搜索')}
              value={tab}
              onChange={setTab}
              options={[
                { id: 'folders' as const, label: t('文件夹') },
                { id: 'search' as const, label: t('搜索') },
              ]}
            />
          </div>
          {tab === 'folders' ? (
            <AssetFolders
              key={tick}
              selected={path}
              onSelect={(p) => nav.open('assets', p, { from: 'folders' })}
              reveal={reveal}
            />
          ) : (
            <AssetSearch
              key={tick}
              selected={path}
              onOpen={(p) => nav.open('assets', p, { from: 'assetSearch' })}
              onReveal={(p) => {
                setTab('folders')
                setReveal(p)
              }}
            />
          )}
        </Card>
        <SplitHandle pane={pane} paneRef={ref} reserve={() => 600} />
        <Inspector
          key={tick}
          page="assets"
          empty={t('选一个资源：DataTable 显示成表格，DataAsset 显示属性，蓝图可以看组件、大纲和图表')}
          onChanged={save.reload}
          onReveal={(p) => {
            setTab('folders')
            setReveal(p)
          }}
        />
      </div>
      {save.dialog}
      <MenuHost />
    </div>
  )
}
