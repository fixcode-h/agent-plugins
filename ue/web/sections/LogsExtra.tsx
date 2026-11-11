import { useState } from 'react'
import { pget, ppost, useAction, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Badge, Card, ErrorText, fmtSize, fmtTime, kindLabel } from '../ui.tsx'

interface Targets {
  running: { pid: number; kind: string; file: string; online: boolean }[]
  offline: { file: string; size: number }
}
interface Crash {
  id: string
  at: string
  error: string
  dir: string
  log: string
}

/** 清空弹窗：列出会被清空的进程和日志文件；默认只勾目标所在的进程，可以全选；可选先另存一份 */
export function ClearDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { project, target } = useUe()
  const { ui, toast } = h()
  const { busy, run } = useAction()
  const tg = useLoad(() => pget<Targets>(project.id, 'logs/targets'), [project.id])
  const [pids, setPids] = useState<number[]>()
  const [backup, setBackup] = useState(false)
  const running = tg.data?.running ?? []
  const chosen =
    pids ?? (running.length ? [typeof target.instance === 'number' ? target.instance : running[0].pid] : [])
  return (
    <ui.Modal
      open
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('清空日志')}
      size="sm"
      footer={
        <>
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button
            variant="danger"
            disabled={!!busy || !tg.data || (running.length > 0 && !chosen.length)}
            onClick={() =>
              void run('clear', async () => {
                await ppost(project.id, 'logs/clear', { pids: chosen, backup })
                toast.success(t('日志已清空'))
                onDone()
                onClose()
              })
            }
          >
            {t('清空')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-3 ue:text-body">
        <ErrorText>{tg.error}</ErrorText>
        {running.length ? (
          <>
            <p className="ue:text-muted">
              {t('UE 正占着日志文件，由进程里的桥接插件关闭、清空、在原文件名上重新打开继续写：')}
            </p>
            <ul className="ue:flex ue:flex-col ue:gap-1.5">
              {running.map((r) => (
                <li key={r.pid}>
                  <label className="ue:flex ue:cursor-pointer ue:items-start ue:gap-2">
                    <input
                      type="checkbox"
                      className="ue:mt-1"
                      checked={chosen.includes(r.pid)}
                      disabled={!r.online}
                      onChange={(e) =>
                        setPids(e.target.checked ? [...chosen, r.pid] : chosen.filter((p) => p !== r.pid))
                      }
                    />
                    <span className="ue:min-w-0">
                      <span className="ue:text-fg">
                        {kindLabel(r.kind)} · PID {r.pid}
                      </span>
                      {!r.online && <Badge tone="danger">{t('连不上')}</Badge>}
                      <span className="ue:block ue:truncate ue:font-mono ue:text-footnote ue:text-subtle">
                        {r.file}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : (
          tg.data && (
            <p className="ue:text-muted">
              {t('UE 没在运行，直接清空 {f}（{size}）', {
                f: tg.data.offline.file,
                size: fmtSize(tg.data.offline.size),
              })}
            </p>
          )
        )}
        <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-2 ue:text-footnote ue:text-muted">
          <input
            type="checkbox"
            checked={backup}
            onChange={(e) => setBackup(e.target.checked)}
            disabled={!running.length}
          />
          {t('清空前另存一份到 Saved/Logs/Cleared/')}
        </label>
        <p className="ue:text-footnote ue:text-subtle">
          {t('清空不能撤回。进程在运行但没装桥接时清不了，不会强制结束进程。')}
        </p>
      </div>
    </ui.Modal>
  )
}

export function Crashes() {
  const { project } = useUe()
  const list = useLoad(() => pget<{ items: Crash[] }>(project.id, 'crashes'), [project.id])
  return (
    <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
      <ErrorText>{list.error}</ErrorText>
      <Card title={t('崩溃记录')} aside="Saved/Crashes">
        <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line">
          {(list.data?.items ?? []).map((c) => (
            <li key={c.id} className="ue:flex ue:flex-col ue:gap-1 ue:px-4 ue:py-2.5">
              <div className="ue:flex ue:items-center ue:gap-2 ue:text-footnote ue:text-subtle">
                <span className="ue:font-mono">{fmtTime(c.at)}</span>
                <span className="ue:truncate">{c.id}</span>
              </div>
              <pre className="ue:font-mono ue:text-footnote ue:whitespace-pre-wrap ue:text-danger">
                {c.error || t('（没有错误信息）')}
              </pre>
              {c.log && <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{c.log}</span>}
            </li>
          ))}
          {list.data && !list.data.items.length && (
            <li className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">{t('没有崩溃记录')}</li>
          )}
        </ul>
      </Card>
    </div>
  )
}
