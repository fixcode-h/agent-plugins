import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { DirtyHeadButton, DirtySection } from '../../asset-dirty/DirtySection.tsx'
import { reloadDirty } from '../../asset-dirty/store.ts'
import { useNavHistory } from '../../inspect/history.ts'
import { Inspector } from '../../inspect/Inspector.tsx'
import { splitSub } from '../../inspect/nav-state.ts'
import { keep, useKept } from '../../keep.ts'
import { takePending } from '../../pending.ts'
import { DockCol } from '../../nav/slot.tsx'
import { PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '@panel/web/src/components/ui/split-pane'
import { Card, PageHead } from '../../ui.tsx'
import { AssetFolders } from './Folders.tsx'
import { FolderView } from './FolderView.tsx'
import { PrecheckButton } from '../../precheck/PrecheckButton.tsx'
import { SelectionBar } from '../../selection/SelectionBar.tsx'

/**
 * 资源页（设计稿第 3、8 节）：和对象页同一套「浏览栏 + 检视区」布局，左边浏览栏是文件夹树（照 Content Browser
 * 点开才读下一层），树上方的搜索框搜整个项目（原来单独的「搜索」页签 2026-11-19 合进来）；右边检视区和对象页是同一个组件、同一份导航历史。
 * 资源的改动只暂存在编辑器里，「保存」才写回（P4 先签出）：改了没保存的列在左栏「当前修改」（2026-11-20 从页头挪过去），
 * 点一项看它的「改动」页、在那里保存或放弃；保存只放在资源页，对象页里改的也在这里存
 */
export function Assets() {
  const { project, sub, reloadBadges } = useUe()
  const { ui } = h()
  const nav = useNavHistory()
  const { path } = splitSub(sub)
  const kk = `${project.id}/assets`
  // Ctrl+K、日志、配置里带过来的名字、路径：填进文件夹树上方的搜索框直接搜（lazy 初始值只看一次，切回来不会再填）
  useState(() => {
    const p = takePending('assets')
    if (p) keep(`${kk}/folders/q`, p)
  })
  // 要在文件夹树里定位的资源：「在文件夹里定位」、从别处（对象页点引用、Ctrl+K、对话）跳过来的
  const [reveal, setReveal] = useKept<string | undefined>(`${kk}/reveal`, undefined)
  const [tick, setTick] = useState(0)
  const pane = usePane('assets', '26%', 220)
  const ref = useRef<HTMLElement>(null)
  // 右栏在列哪个文件夹的内容（设计稿「UE 插件优化与扩展」三.3）：空串时右栏是检视区。
  // 文件夹之间的后退 / 前进单独记一份，不进检视区的导航历史（那份只记资源和对象）
  const [fnav, setFnav] = useKept<{ items: string[]; i: number; on: boolean }>(`${kk}/folderNav`, {
    items: [],
    i: -1,
    on: false,
  })
  const folder = fnav.on ? (fnav.items[fnav.i] ?? '') : ''
  const showFolder = (p: string) =>
    setFnav((s) => {
      if (s.items[s.i] === p) return { ...s, on: true }
      const items = [...s.items.slice(0, s.i + 1), p].slice(-50)
      return { items, i: items.length - 1, on: true }
    })
  const openAsset = (p: string, from: 'folders' | 'assetSearch') => {
    setFnav((s) => ({ ...s, on: false }))
    nav.open('assets', p, { from })
  }

  // 不是在文件夹树里点的（点引用、后退前进、别处跳过来）：树展开到它所在的文件夹并选中
  const cur = nav.current?.path === path ? nav.current : undefined
  useEffect(() => {
    if (path && cur && cur.from !== 'folders') {
      setReveal(path)
      // 检视区后退前进、别处跳过来看资源：右栏换回检视区
      setFnav((s) => ({ ...s, on: false }))
    }
    // 只在换了资源时看
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [path, cur?.from])

  const col = () => (
    <>
      <SelectionBar page="assets" current={folder ? '' : path} onOpen={(p) => openAsset(p, 'assetSearch')} hideEmpty />
      {/* 原来「文件夹 / 搜索」两个页签（用户 2026-11-19 合成一个）：树上方的搜索框直接搜整个项目 */}
      <AssetFolders
        selected={folder ? '' : path}
        onSelect={(p) => openAsset(p, 'folders')}
        reveal={reveal}
        folder={folder}
        onFolder={showFolder}
        tick={tick}
        top={
          // 编辑器里改了没保存的资源（效果图 designs/UE资源页当前修改-效果图）：点一项看它的改动
          <DirtySection selected={folder ? '' : path} onOpen={(p) => openAsset(p, 'folders')} onReveal={setReveal} />
        }
      />
    </>
  )

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title={t('资源')} desc={t('改动点「保存」才写回文件；版本差异优先由开着的编辑器读')}>
        <DirtyHeadButton />
        <PrecheckButton onOpen={(p) => openAsset(p, 'assetSearch')} />
        <ui.Button
          size="sm"
          variant="secondary"
          onClick={() => {
            reloadDirty()
            setTick((n) => n + 1)
          }}
        >
          <RefreshCw className="ue:h-3.5 ue:w-3.5" /> {t('刷新')}
        </ui.Button>
      </PageHead>
      <div className={SPLIT_ROW}>
        {/* 文件夹 / 搜索整栏放进左边二级面板（用户 2026-11-18 定）；面板太旧或二级面板收起时照旧是页里左边一栏 */}
        <DockCol
          body={col}
          fallback={
            <>
              <Card
                ref={ref}
                className={PANE_FIXED}
                style={pane.style('calc(100% - 600px)')}
                bodyClass="ue:flex ue:min-h-0 ue:flex-col"
              >
                {col()}
              </Card>
              <SplitHandle pane={pane} paneRef={ref} reserve={() => 600} />
            </>
          }
        />
        {folder ? (
          <FolderView
            path={folder}
            tick={tick}
            canBack={fnav.i > 0}
            canForward={fnav.i < fnav.items.length - 1}
            onBack={() => setFnav((s) => ({ ...s, i: Math.max(0, s.i - 1) }))}
            onForward={() => setFnav((s) => ({ ...s, i: Math.min(s.items.length - 1, s.i + 1) }))}
            onFolder={showFolder}
            onOpen={(p) => openAsset(p, 'folders')}
          />
        ) : (
          <Inspector
            key={tick}
            page="assets"
            empty={t('选一个资源：DataTable 显示成表格，DataAsset 显示属性，蓝图可以看组件、大纲和图表')}
            onChanged={() => {
              reloadDirty()
              reloadBadges()
            }}
            onReveal={setReveal}
          />
        )}
      </div>
    </div>
  )
}
