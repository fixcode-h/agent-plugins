import { useState } from 'react'
import type { EditResult, GtPath, GtScript } from '../../../../../shared/gt-script/index.ts'
import { t } from '../../../../host.ts'
import { SearchBox } from '../../../../ui.tsx'
import { PaletteGrid } from './PaletteGrid.tsx'
import { ScriptLib } from './ScriptLib.tsx'

export interface EditRailProps {
  doc: GtScript
  selected: GtPath[]
  onChange: (r: EditResult | GtScript | undefined, what?: string) => boolean
  onSelect: (paths: GtPath[]) => void
  scenarios: { name: string; relativePath: string; steps: number; tags?: string[] }[]
  /** 打开着的场景相对路径（含 .json） */
  current: string
  onOpen: (relativePath: string) => void
}

/**
 * GameTest 脚本编辑页的左栏（效果图 1、5、11）：搜索框同时筛节点格子和脚本库；
 * 节点格子来自 palette.ts 的注册表，脚本库拖进来就是「调用脚本」。底部一行说明固定不滚
 */
export function EditRail(props: EditRailProps) {
  const [q, setQ] = useState('')
  const query = q.toLowerCase()
  return (
    <div className="ue:flex ue:w-[300px] ue:shrink-0 ue:flex-col ue:border-r ue:border-line ue:bg-panel">
      <div className="ue:shrink-0 ue:px-3 ue:pt-3 ue:pb-2">
        <SearchBox live allowEmpty onSearch={setQ} placeholder={t('找节点、脚本、片段')} />
      </div>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-y-auto ue:px-3 ue:pb-3">
        <Title>{t('节点 · 拖到画布上，或在连线上点 +')}</Title>
        <PaletteGrid
          doc={props.doc}
          selected={props.selected}
          onChange={props.onChange}
          onSelect={props.onSelect}
          q={query}
        />
        <Title>{t('脚本库 · 拖进来就是「调用脚本」')}</Title>
        <ScriptLib scenarios={props.scenarios} current={props.current} onOpen={props.onOpen} q={query} />
      </div>
      <div className="ue:shrink-0 ue:border-t ue:border-line ue:px-3 ue:py-2 ue:text-caption ue:text-subtle">
        {t('拖进来就是调用脚本，跟着原脚本变；录好的脚本也能整段拖进「守护」当处理办法。')}
      </div>
    </div>
  )
}

function Title({ children }: { children: string }) {
  return <div className="ue:pt-3 ue:pb-1.5 ue:text-footnote ue:text-subtle">{children}</div>
}
