import { Trash2 } from 'lucide-react'
import { h, t } from '../../host.ts'
import { AddButton, SettingGroup, SettingList } from '../../SettingRows.tsx'

/** 运行配置 itemKeys 的一条（GameTest 1.4.0）：这类条目怎么认 */
export interface GtKeyRule {
  /** 条目类名（WBP_BagSlot，带不带 _C 都行） */
  entry: string
  /** 只管这个容器（选择器前缀）；空 = 这类条目在哪个容器里都这样认 */
  container?: string
  /** 条件左边的写法：Data.ItemId、@lua.cfgId…… */
  by: string[]
}

/** 存盘前收拾：空行不存，by 按逗号拆 */
export function tidyKeyRules(rules: GtKeyRule[]) {
  return rules
    .map((r) => ({
      entry: r.entry.trim(),
      ...(r.container?.trim() ? { container: r.container.trim() } : {}),
      by: r.by.map((b) => b.trim()).filter(Boolean),
    }))
    .filter((r) => r.entry && r.by.length)
}

/**
 * 运行设置里的「条目怎么认」（效果图 3 右下）：录制时点到这些条目直接按规则写，不再暂停问。
 * 规则一般是录制弹窗里勾「以后都按这个认」加的，这里能看、改、删、手加。
 */
export function GtKeyRules({
  value,
  onChange,
  framed,
}: {
  value: GtKeyRule[]
  onChange: (v: GtKeyRule[]) => void
  framed?: boolean
}) {
  const { ui } = h()
  const patch = (i: number, p: Partial<GtKeyRule>) => onChange(value.map((r, k) => (k === i ? { ...r, ...p } : r)))
  return (
    <SettingGroup
      title={t('条目怎么认')}
      framed={framed}
      aside={<AddButton onClick={() => onChange([...value, { entry: '', by: [] }])} />}
      desc={t(
        '录制时点到列表、格子里的这些条目，直接按规则里的字段认（如物品 Id），不再暂停问。录制弹窗里勾「以后都按这个认」会加到这里。',
      )}
    >
      <SettingList count={value.length}>
        {value.map((r, i) => (
          <div
            key={i}
            className="ue:grid ue:items-center ue:gap-2 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:p-2.5 ue:sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]"
          >
            <ui.Input
              size="sm"
              className="ue:font-mono"
              placeholder={t('条目类名，例如 WBP_BagSlot')}
              value={r.entry}
              onChange={(e: { target: { value: string } }) => patch(i, { entry: e.target.value })}
            />
            <ui.Input
              size="sm"
              className="ue:font-mono"
              placeholder={t('按什么认，例如 Data.ItemId（多个用逗号）')}
              value={r.by.join(', ')}
              onChange={(e: { target: { value: string } }) => patch(i, { by: e.target.value.split(',') })}
            />
            <ui.IconButton
              icon={Trash2}
              size="sm"
              label={t('删除这条')}
              onClick={() => onChange(value.filter((_, k) => k !== i))}
            />
            <ui.Input
              size="sm"
              className="ue:font-mono ue:sm:col-span-2"
              placeholder={t('只管这个容器（选择器前缀，可不填）')}
              value={r.container ?? ''}
              onChange={(e: { target: { value: string } }) => patch(i, { container: e.target.value })}
            />
          </div>
        ))}
      </SettingList>
    </SettingGroup>
  )
}
