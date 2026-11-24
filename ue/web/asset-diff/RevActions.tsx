import { History, MessageSquareText, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { AssetDiff } from '../../shared/asset-diff/types.ts'
import { ppost } from '../api.ts'
import { useToChat } from '../chat.tsx'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'

/**
 * 头部的两个动作（设计稿「UE资源版本差异-修复与强化」3.3、3.4）：
 * 「还原到这一版」会改本地文件，只有用户在页面上点（不做成 Agent 工具），点了先确认，编辑器里有没保存的改动再标黄确认一次；
 * 「让 Agent 解释」把算好的差异写成文件，路径放进对话输入框，用户看过再发
 */
export function RevActions({
  pkg,
  rev,
  revLabel,
  local,
  diff,
  a,
  b,
  onRestored,
}: {
  pkg: string
  /** 还原到哪一版（本地改动页是最近一次提交 / #have） */
  rev: string
  revLabel: string
  local: boolean
  diff?: AssetDiff
  a: string
  b: string
  onRestored: () => void
}) {
  const { project } = useUe()
  const { ui, toast } = h()
  const chat = useToChat()
  const [ask, setAsk] = useState<null | 'confirm' | 'dirty'>(null)
  const [busy, setBusy] = useState(false)
  const restore = (force: boolean) => {
    setBusy(true)
    ppost<{ dirty?: true; restored?: string; reloaded?: boolean }>(project.id, 'asset-diff/restore', {
      path: pkg,
      rev,
      force,
    })
      .then((r) => {
        if (r.dirty) return setAsk('dirty')
        setAsk(null)
        toast.success(
          r.reloaded
            ? t('已还原到 {rev}，编辑器里重新加载了：{f}', { rev: revLabel, f: r.restored ?? '' })
            : t('已还原到 {rev}：{f}', { rev: revLabel, f: r.restored ?? '' }),
        )
        onRestored()
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false))
  }
  const explain = () => {
    if (!diff) return
    setBusy(true)
    ppost<{ file: string }>(project.id, 'asset-diff/explain', { path: pkg, a, b, diff })
      .then((r) =>
        chat.send(
          `读 ${r.file}（UE 资源 ${pkg} 从 ${a} 到 ${b} 的结构差异），说明这次改动做了什么、可能影响哪些地方、有没有风险。`,
        ),
      )
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false))
  }
  return (
    <>
      {chat.available && diff && (
        <ui.Button size="sm" variant="secondary" disabled={busy} onClick={explain}>
          <MessageSquareText className="ue:h-3.5 ue:w-3.5" /> {t('让 Agent 解释')}
        </ui.Button>
      )}
      <ui.Button size="sm" variant="secondary" disabled={busy} onClick={() => setAsk('confirm')}>
        <History className="ue:h-3.5 ue:w-3.5" />
        {local ? t('本地换回 {rev}', { rev: revLabel }) : t('还原到这一版')}
      </ui.Button>
      {chat.dialog}
      {ask && (
        <ui.Modal
          open
          size="sm"
          onOpenChange={(o: boolean) => !o && setAsk(null)}
          title={local ? t('本地换回 {rev}', { rev: revLabel }) : t('还原到 {rev}', { rev: revLabel })}
          footer={
            <>
              <ui.Button variant="secondary" onClick={() => setAsk(null)}>
                {t('取消')}
              </ui.Button>
              <ui.Button
                variant={ask === 'dirty' ? 'danger' : 'primary'}
                disabled={busy}
                onClick={() => restore(ask === 'dirty')}
              >
                {busy ? t('还原中…') : ask === 'dirty' ? t('丢掉编辑器里的改动并还原') : t('还原')}
              </ui.Button>
            </>
          }
        >
          <div className="ue:flex ue:flex-col ue:gap-2 ue:text-body">
            <p>{t('用 {rev} 的文件覆盖本地的 {name}。', { rev: revLabel, name: pkg.split('/').pop() ?? pkg })}</p>
            <ul className="ue:list-disc ue:pl-5 ue:text-footnote ue:text-muted">
              {project.vcs === 'p4' && <li>{t('P4 先签出这个文件（进默认变更列表，不提交）')}</li>}
              <li>{t('编辑器开着时让它从磁盘重新加载这个资源')}</li>
              <li>{t('只改本地文件，要提交的话你自己提交')}</li>
            </ul>
            {ask === 'dirty' && (
              <p className="ue:flex ue:items-start ue:gap-2 ue:rounded-md ue:bg-warning/10 ue:px-2.5 ue:py-2 ue:text-footnote ue:text-warning">
                <TriangleAlert className="ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0" />
                {t('编辑器里这个资源有没保存的改动，还原会把它们丢掉。')}
              </p>
            )}
          </div>
        </ui.Modal>
      )}
    </>
  )
}
