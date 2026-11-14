import { useMemo, useState } from 'react'
import { History } from 'lucide-react'
import { t } from '@shared/i18n'
import { cellRef } from '@shared/table-edit'
import type { TableDoc } from '@shared/tables'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { draftCount, planRestore, type Draft } from './table-drafts'

/** 冲突列表最多列这么多格 */
const SHOW = 200

/** 「3 分钟前」「昨天 14:20」这类：草稿是什么时候留下的 */
export function when(at: number) {
  const min = Math.round((Date.now() - at) / 60_000)
  if (min < 1) return t('刚才')
  if (min < 60) return t('{n} 分钟前', { n: min })
  const d = new Date(at)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days === 0) return t('今天 {hm}', { hm })
  if (days === 1) return t('昨天 {hm}', { hm })
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

/**
 * 打开文件时发现上次没保存的改动（草稿）：表格上方一条提示，恢复还是丢掉。
 * 文件在外面改过时先说清楚：能直接放回几格、几格两边都改了（可以点开看，选用哪边）；
 * 草稿里插删过行列、文件又改过时，位置可能对不上，只给「仍按原位置恢复」并提醒先核对
 */
export function DraftBar({
  draft,
  doc,
  editing,
  onRestore,
  onDiscard,
}: {
  draft: Draft
  doc: TableDoc
  /** 页面上已经有改动：恢复会替换掉 */
  editing: boolean
  onRestore: (keep: 'mine' | 'file') => void
  onDiscard: () => void
}) {
  const plan = useMemo(() => planRestore(draft, doc), [draft, doc])
  const [detail, setDetail] = useState(false)
  const count = draftCount(draft)
  const stamp = when(draft.savedAt)
  const lead = !plan.moved
    ? t('有上次没保存的改动（{n} 处，{when}），文件之后没被改过。', { when: stamp, n: count })
    : plan.structural
      ? t(
          '有上次没保存的改动（{n} 处，{when}，含插删行列），但文件之后在外面被改过，行列位置可能对不上。恢复后请先核对再保存。',
          { when: stamp, n: count },
        )
      : plan.conflicts.length
        ? t('有上次没保存的改动（{when}）：文件之后在外面被改过，{clean} 格能直接放回，{k} 格两边都改了。', {
            when: stamp,
            clean: plan.clean,
            k: plan.conflicts.length,
          })
        : t('有上次没保存的改动（{n} 格，{when}）。文件之后在外面被改过，但改的不是同一些格子，可以直接放回。', {
            when: stamp,
            n: count,
          })
  return (
    <div
      role="status"
      className="tb:flex tb:shrink-0 tb:flex-wrap tb:items-center tb:gap-2 tb:border-b tb:bg-accent/8 tb:px-3 tb:py-1.5 tb:text-footnote tb:text-fg"
    >
      <History className="tb:h-3.5 tb:w-3.5 tb:shrink-0 tb:text-accent-text" />
      <span className="tb:mr-auto tb:min-w-0">
        {lead}
        {plan.missing.length > 0 && (
          <span className="tb:text-warning">
            {' '}
            {t('工作表 {names} 已经不在了，那部分放不回去。', { names: plan.missing.join('、') })}
          </span>
        )}
        {editing && <span className="tb:text-subtle"> {t('恢复会替换掉你刚才在这里做的改动。')}</span>}
      </span>
      {plan.conflicts.length > 0 ? (
        <>
          <Button size="sm" variant="ghost" className="tb:h-6" onClick={() => setDetail(true)}>
            {t('看冲突的格子')}
          </Button>
          <Button size="sm" variant="secondary" className="tb:h-6" onClick={() => onRestore('file')}>
            {t('恢复，冲突的用文件里的')}
          </Button>
          <Button size="sm" variant="secondary" className="tb:h-6" onClick={() => onRestore('mine')}>
            {t('恢复，冲突的用我的')}
          </Button>
        </>
      ) : (
        <Button size="sm" variant="secondary" className="tb:h-6" onClick={() => onRestore('mine')}>
          {plan.moved && plan.structural ? t('仍按原位置恢复') : t('恢复')}
        </Button>
      )}
      <Button size="sm" variant="ghost" className="tb:h-6" onClick={onDiscard}>
        {t('丢掉')}
      </Button>
      {detail && (
        <Modal open onOpenChange={(o) => !o && setDetail(false)} title={t('两边都改了的格子')} size="md" closeOnOutside>
          <div className="tb:max-h-[60vh] tb:overflow-auto tb:rounded-lg tb:border">
            <table className="tb:w-full tb:text-footnote">
              <thead className="tb:bg-panel tb:text-caption tb:text-subtle">
                <tr>
                  <th className="tb:px-3 tb:py-1.5 tb:text-left tb:font-normal">{t('格子')}</th>
                  <th className="tb:px-2 tb:py-1.5 tb:text-left tb:font-normal">{t('文件里现在')}</th>
                  <th className="tb:px-2 tb:py-1.5 tb:text-left tb:font-normal">{t('我改的')}</th>
                </tr>
              </thead>
              <tbody>
                {plan.conflicts.slice(0, SHOW).map((x) => (
                  <tr key={`${x.sheet}:${x.r}:${x.c}`} className="tb:border-t">
                    <td className="tb:w-24 tb:px-3 tb:py-1 tb:font-mono tb:text-subtle">
                      {doc.sheets.length > 1 ? `${x.sheet}!` : ''}
                      {cellRef(x.r, x.c)}
                    </td>
                    <td className="tb:max-w-0 tb:truncate tb:px-2 tb:py-1" title={x.file}>
                      {x.file || <span className="tb:text-subtle">{t('（空）')}</span>}
                    </td>
                    <td className="tb:max-w-0 tb:truncate tb:px-2 tb:py-1 tb:text-fg" title={x.mine}>
                      {x.mine || <span className="tb:text-subtle">{t('（清空）')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {plan.conflicts.length > SHOW && (
              <p className="tb:px-3 tb:py-1.5 tb:text-caption tb:text-subtle">
                {t('还有 {n} 格', { n: plan.conflicts.length - SHOW })}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
