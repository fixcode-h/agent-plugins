import { Trash2 } from 'lucide-react'
import { ASSET_KINDS } from '../../asset-icons.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useSearchIndex } from '../../jump/index-data.ts'
import { AddButton, SettingGroup, SettingList } from '../../SettingRows.tsx'
import { SuggestInput, type SuggestRow } from '../../SuggestInput.tsx'
import type { BlockerRule } from './gt-guards/model.ts'
import { matchWidgets } from './gt-widget-match.ts'

const blank = (): BlockerRule => ({ widget: '', action: 'close' })

const WIDGET_LIMIT = 50

/** 候选 → 下拉的行：认不出类型的（扫磁盘时没有类名）淡显 */
function widgetRows(m: ReturnType<typeof matchWidgets>): { rows: SuggestRow[]; total: number } {
  const { icon, tone } = ASSET_KINDS['umg-widget']
  return {
    total: m.total,
    rows: m.rows.map((w) => ({ key: w.pkg, value: w.value, label: w.name, detail: w.pkg, icon, tone, dim: !w.sure })),
  }
}

/**
 * 阻挡界面（GameTest 1.9.0 以前）：装着旧版 GameTest 时设置页还显示这一组，存 _settings.json 的 blockers。
 * 1.9.0 起换成全局守护（GtGuardsGroup），GameTest 第一次读到 blockers 时自己改写成 guards
 */
export function GtBlockersGroup({ rules, onChange }: { rules: BlockerRule[]; onChange: (r: BlockerRule[]) => void }) {
  const { project } = useUe()
  const { ui, cn } = h()
  // WBP 候选：跳转弹窗同一份本地索引，打开设置时取一次（没变只回 same），打字只在网页里筛
  const index = useSearchIndex(project.id)
  const patch = (i: number, p: Partial<BlockerRule>) => onChange(rules.map((r, k) => (k === i ? { ...r, ...p } : r)))
  const label = 'ue:text-footnote ue:text-subtle'
  const suggestWidgets = (q: string) => widgetRows(matchWidgets(index.idx, q, WIDGET_LIMIT))
  const indexStatus = index.error
    ? t('读索引失败：{e}', { e: index.error })
    : !index.idx
      ? t('正在读资源索引…')
      : t('{src} · 控件蓝图 {n} 个', {
          src: index.idx.source.assets === 'uetovs' ? t('来自 UEToVS 索引') : t('扫磁盘'),
          n: matchWidgets(index.idx, '', 0).all,
        })
  return (
    <SettingGroup
      page="guards"
      title={t('阻挡界面')}
      action={<AddButton onClick={() => onChange([...rules, blank()])} />}
      hint={t(
        '公告、新手引导、活动弹窗这类不定时弹出的界面：跑测试时一出现就按规则处理掉，不让它挡住后面的步骤。正在等的那一步要点的就是它时不处理；每次处理都记在那一步的结果里。',
      )}
    >
      <SettingList count={rules.length}>
        {rules.map((r, i) => (
          <div
            key={i}
            className={cn(
              'ue:flex ue:flex-col ue:gap-2 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:p-2.5',
              r.enabled === false && 'ue:opacity-60',
            )}
          >
            <div className="ue:flex ue:items-center ue:gap-2">
              <SuggestInput
                className="ue:min-w-0 ue:flex-1"
                inputClassName="ue:font-mono"
                placeholder={t('WBP 类名或资产路径，例如 WBP_Notice')}
                value={r.widget}
                onChange={(v) => patch(i, { widget: v })}
                suggest={suggestWidgets}
                status={indexStatus}
                empty={t('索引里没找到控件蓝图，可以直接填类名或资产路径')}
              />
              <ui.Select
                size="sm"
                className="ue:w-36"
                value={r.action}
                onChange={(e: { target: { value: string } }) =>
                  patch(i, { action: e.target.value as BlockerRule['action'] })
                }
                options={[
                  { value: 'close', label: t('关闭') },
                  { value: 'call', label: t('调用函数') },
                  { value: 'command', label: t('执行指令') },
                ]}
              />
              <ui.IconButton
                icon={Trash2}
                size="sm"
                label={t('删除这条')}
                onClick={() => onChange(rules.filter((_, k) => k !== i))}
              />
            </div>
            {r.action === 'call' && (
              <ui.Input
                size="sm"
                className="ue:font-mono"
                placeholder={t('界面上的无参函数名，例如 Close')}
                value={r.function ?? ''}
                onChange={(e: { target: { value: string } }) => patch(i, { function: e.target.value })}
              />
            )}
            {r.action === 'command' && (
              <ui.Input
                size="sm"
                className="ue:font-mono"
                placeholder={t('控制台指令或 GM，例如 gm.SkipGuide')}
                value={r.command ?? ''}
                onChange={(e: { target: { value: string } }) => patch(i, { command: e.target.value })}
              />
            )}
            <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
              <span className={label}>{t('出现后等')}</span>
              <ui.Input
                size="sm"
                className="ue:w-20"
                inputMode="numeric"
                value={String(r.delayMs ?? 0)}
                onChange={(e: { target: { value: string } }) =>
                  patch(i, { delayMs: Math.max(0, Math.round(Number(e.target.value) || 0)) })
                }
              />
              <span className={label}>{t('毫秒再处理')}</span>
              <ui.Input
                size="sm"
                className="ue:min-w-0 ue:flex-1"
                placeholder={t('说明（可选）')}
                value={r.note ?? ''}
                onChange={(e: { target: { value: string } }) => patch(i, { note: e.target.value || undefined })}
              />
              <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1.5 ue:text-footnote ue:text-fg">
                <input
                  type="checkbox"
                  className="ue:accent-(--accent)"
                  checked={r.enabled !== false}
                  onChange={(e) => patch(i, { enabled: e.target.checked ? undefined : false })}
                />
                {t('启用')}
              </label>
            </div>
          </div>
        ))}
      </SettingList>
    </SettingGroup>
  )
}
