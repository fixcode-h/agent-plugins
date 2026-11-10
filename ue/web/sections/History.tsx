import { Undo2 } from 'lucide-react'
import { useState } from 'react'
import type { HistoryItem } from '../../server/types.ts'
import { pget, ppost, show, useAction, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Badge, Confirm, ErrorText, LinkBtn, PageHead, fmtTime, kindLabel } from '../ui.tsx'

/** 操作记录：时间、谁（你 / 某个对话，可点进对话）、目标、操作、改前改后、结果、撤回 */
export function History() {
  const { project } = useUe()
  const { ui, cn, hooks } = h()
  const nav = hooks.useNav()
  const { busy, run } = useAction()
  const [who, setWho] = useState('')
  const [clearing, setClearing] = useState(false)
  const list = useLoad(() => pget<{ items: HistoryItem[] }>(project.id, 'history'), [project.id], 5000)
  const items = (list.data?.items ?? []).filter(
    (i) => !who || (who === 'user' ? i.actor.kind === 'user' : i.actor.kind === 'agent'),
  )
  const cell = 'ue:border-b ue:border-line ue:px-3 ue:py-2 ue:align-top'
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title={t('操作记录')} desc={t('你和 Agent 做过的修改；运行时修改可以撤回，保留天数在插件参数里改')}>
        <ui.Select
          size="sm"
          className="ue:w-32"
          value={who}
          onChange={(e: { target: { value: string } }) => setWho(e.target.value)}
          options={[
            { value: '', label: t('全部') },
            { value: 'user', label: t('你') },
            { value: 'agent', label: 'Agent' },
          ]}
        />
        <ui.Button size="sm" variant="ghost" onClick={() => setClearing(true)}>
          {t('清空记录')}
        </ui.Button>
      </PageHead>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:p-6">
        <ErrorText>{list.error}</ErrorText>
        <table className="ue:w-full ue:border-separate ue:border-spacing-0 ue:text-footnote">
          <thead className="ue:sticky ue:top-0 ue:bg-bg ue:text-left ue:text-subtle">
            <tr>
              {[t('时间'), t('谁'), t('目标实例'), t('操作'), t('改前 → 改后'), t('结果'), ''].map((x, i) => (
                <th key={i} className="ue:border-b ue:border-line ue:px-3 ue:py-2 ue:font-medium">
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="ue:hover:bg-hover">
                <td className={cn(cell, 'ue:font-mono ue:whitespace-nowrap ue:text-subtle')}>{fmtTime(it.at)}</td>
                <td className={cn(cell, 'ue:whitespace-nowrap')}>
                  {it.actor.kind === 'user' ? (
                    t('你')
                  ) : (
                    <button
                      type="button"
                      className="ue:cursor-pointer ue:text-accent-text ue:hover:underline"
                      onClick={() =>
                        it.actor.kind === 'agent' && nav.go({ page: 'projects', id: project.id, sub: it.actor.taskId })
                      }
                    >
                      {it.actor.agent || t('对话')}
                    </button>
                  )}
                </td>
                <td className={cn(cell, 'ue:whitespace-nowrap ue:text-muted')}>
                  {it.instanceKind ? `${kindLabel(it.instanceKind)}${it.world ? ` · ${it.world}` : ''}` : '—'}
                </td>
                <td className={cn(cell, 'ue:max-w-96 ue:font-mono ue:break-all ue:text-fg')}>
                  <span className="ue:text-subtle">{it.op}</span> {it.summary}
                </td>
                <td className={cn(cell, 'ue:max-w-60 ue:font-mono ue:break-all ue:text-muted')}>
                  {it.prev !== undefined ? (
                    <>
                      <s>{show(it.prev)}</s> → {show(it.value)}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={cell}>
                  {it.ok ? (
                    <Badge tone={it.undone ? 'muted' : 'ok'}>{it.undone ? t('已撤回') : t('成功')}</Badge>
                  ) : (
                    <Badge tone="danger" title={it.error}>
                      {t('失败')}
                    </Badge>
                  )}
                  {it.error && <div className="ue:mt-1 ue:max-w-60 ue:break-all ue:text-danger">{it.error}</div>}
                </td>
                <td className={cn(cell, 'ue:text-right')}>
                  {it.undo && !it.undone ? (
                    <LinkBtn
                      disabled={!!busy}
                      onClick={() =>
                        void run(it.id, () => ppost(project.id, 'undo', { id: it.id }).then(() => list.reload()))
                      }
                    >
                      <Undo2 className="ue:h-3 ue:w-3" /> {t('撤回修改')}
                    </LinkBtn>
                  ) : (
                    it.ok &&
                    !it.undone && (
                      <span className="ue:text-caption ue:text-subtle" title={it.noUndo}>
                        {t('不能撤回')}
                      </span>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && !items.length && (
          <p className="ue:p-8 ue:text-center ue:text-footnote ue:text-subtle">{t('没有记录')}</p>
        )}
      </div>
      <Confirm
        open={clearing}
        title={t('清空操作记录？')}
        okText={t('清空')}
        danger
        onCancel={() => setClearing(false)}
        onOk={() =>
          void run('clear', async () => {
            setClearing(false)
            await ppost(project.id, 'history/clear')
            void list.reload()
          })
        }
      >
        {t('清空后这些修改就不能再从这里撤回了。')}
      </Confirm>
    </div>
  )
}
