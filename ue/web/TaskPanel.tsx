import { Camera, ExternalLink, Undo2 } from 'lucide-react'
import { useState } from 'react'
import type { HistoryItem, ProjectState } from '../server/types.ts'
import { op, pget, ppost, useAction, useLoad } from './api.ts'
import { h, t } from './host.ts'
import { Badge, Dot, ErrorText, LinkBtn, fmtTime, kindLabel, worldLabel } from './ui.tsx'

/** 对话右栏的「UE」页签（图 7）：连接、目标、本对话做过的修改（可撤回）、截一张视口 */
export function TaskPanel({ taskId, projectId }: { taskId: string; projectId: string }) {
  const { ui, hooks } = h()
  const nav = hooks.useNav()
  const { busy, run } = useAction()
  const state = useLoad(() => pget<ProjectState>(projectId, 'state'), [projectId], 5000)
  const hist = useLoad(() => pget<{ items: HistoryItem[] }>(projectId, 'history'), [projectId], 5000)
  const [shot, setShot] = useState<{ png: string; world: string }>()
  const mine = (hist.data?.items ?? []).filter((i) => i.actor.kind === 'agent' && i.actor.taskId === taskId)
  const s = state.data
  const live = (s?.instances ?? []).filter((i) => i.kind !== 'background')
  return (
    <div className="ue:flex ue:h-full ue:flex-col ue:gap-4 ue:overflow-auto ue:p-4">
      <section className="ue:flex ue:flex-col ue:gap-2">
        <div className="ue:flex ue:items-center ue:gap-2">
          <span className="ue:text-heading ue:font-medium ue:text-fg">{s?.project.name ?? 'UE'}</span>
          <ui.Button
            size="sm"
            variant="ghost"
            className="ue:ml-auto"
            onClick={() => nav.go({ page: 'plugin', id: 'ue', sub: 'main', msg: projectId })}
          >
            <ExternalLink className="ue:h-3.5 ue:w-3.5" /> {t('打开 UE 页')}
          </ui.Button>
        </div>
        <ErrorText>{state.error}</ErrorText>
        {live.map((i) => (
          <div
            key={i.pid}
            className="ue:flex ue:flex-col ue:gap-1 ue:rounded-lg ue:border ue:border-line ue:px-3 ue:py-2"
          >
            <div className="ue:flex ue:items-center ue:gap-2 ue:text-body ue:text-fg">
              <Dot tone={i.online ? 'ok' : 'danger'} /> {kindLabel(i.kind)}{' '}
              <span className="ue:text-footnote ue:text-subtle">PID {i.pid}</span>
            </div>
            <div className="ue:flex ue:flex-wrap ue:gap-1">
              {i.worlds.map((w) => (
                <Badge key={w.id}>{worldLabel(w)}</Badge>
              ))}
            </div>
          </div>
        ))}
        {s && !live.length && (
          <p className="ue:text-footnote ue:text-subtle">{t('UE 没在运行。Agent 读资源时会自动起后台编辑器')}</p>
        )}
        <div className="ue:text-footnote ue:text-subtle">
          {t('Agent 权限：运行时 {r} · 资源 {a}', {
            r:
              s?.project.perms.runtime === 'write'
                ? t('可写')
                : s?.project.perms.runtime === 'ask'
                  ? t('写前问我')
                  : t('只读'),
            a:
              s?.project.perms.asset === 'save'
                ? t('直接保存')
                : s?.project.perms.asset === 'ask'
                  ? t('保存前问我')
                  : t('只读'),
          })}
        </div>
      </section>

      <section className="ue:flex ue:flex-col ue:gap-2">
        <div className="ue:text-footnote ue:font-medium ue:text-muted">{t('这个对话的修改')}</div>
        {mine.map((it) => (
          <div key={it.id} className="ue:flex ue:items-start ue:gap-2 ue:rounded-lg ue:bg-hover/60 ue:px-3 ue:py-2">
            <div className="ue:min-w-0 ue:flex-1">
              <div className="ue:text-caption ue:text-subtle">
                {fmtTime(it.at)} · {it.op}
              </div>
              <div className="ue:font-mono ue:text-footnote ue:break-all ue:text-fg">{it.summary}</div>
              {it.error && <div className="ue:text-footnote ue:text-danger">{it.error}</div>}
            </div>
            {it.undo && !it.undone ? (
              <LinkBtn
                disabled={!!busy}
                onClick={() => void run(it.id, () => ppost(projectId, 'undo', { id: it.id }).then(() => hist.reload()))}
              >
                <Undo2 className="ue:h-3 ue:w-3" /> {t('撤回修改')}
              </LinkBtn>
            ) : it.undone ? (
              <Badge>{t('已撤回')}</Badge>
            ) : null}
          </div>
        ))}
        {hist.data && !mine.length && <p className="ue:text-footnote ue:text-subtle">{t('还没有修改')}</p>}
      </section>

      {live.length > 0 && (
        <section className="ue:flex ue:flex-col ue:gap-2">
          <ui.Button
            size="sm"
            variant="secondary"
            disabled={busy === 'shot'}
            onClick={() =>
              void run('shot', async () =>
                setShot(await op(projectId, 'screenshot', { maxWidth: 960 }, undefined, 20000)),
              )
            }
          >
            <Camera className="ue:h-3.5 ue:w-3.5" /> {t('截视口')}
          </ui.Button>
          {shot && (
            <img
              src={`data:image/png;base64,${shot.png}`}
              alt={shot.world}
              className="ue:w-full ue:rounded-lg ue:border ue:border-line"
            />
          )}
        </section>
      )}
    </div>
  )
}
