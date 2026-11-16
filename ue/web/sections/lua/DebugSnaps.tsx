import { Camera, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { op, useAction, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Badge, Card, ErrorText, LinkBtn, Note } from '../../ui.tsx'
import { useExtEvents } from '../uekit/ListCol.tsx'
import type { Snap, SnapCapture } from './debug-types.ts'
import { CaptureView } from './DebugViews.tsx'
import { useOpenLua } from './open-file.ts'

/**
 * 快照点（设计稿四.4）：执行到某个文件某一行时记下局部变量和调用栈，游戏不暂停，命中几次自动撤掉。
 * 命中由桥接推 lua.snap 事件过来（不轮询），选中的那个快照点的记录跟着刷新
 */
export function DebugSnaps() {
  const { project, target } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const open = useOpenLua()
  const [file, setFile] = useState('')
  const [line, setLine] = useState('')
  const [hits, setHits] = useState('1')
  const [sel, setSel] = useState(0)
  const list = useLoad(
    () => op<{ items: Snap[]; warning?: string }>(project.id, 'lua.snap', { action: 'list' }, target),
    [project.id, target.instance, target.world],
  )
  const detail = useLoad(
    () =>
      sel
        ? op<{ items: Snap[] }>(project.id, 'lua.snap', { action: 'list', id: sel }, target).then((r) => r.items[0])
        : Promise.resolve(undefined),
    [sel, target.instance, target.world],
  )
  useExtEvents(project.id, (e) => {
    if (e.event !== 'lua.snap') return
    void list.reload()
    if (Number(e.id) === sel && detail.data)
      detail.setData({
        ...detail.data,
        hits: Number(e.hits),
        active: !!e.active,
        captures: [...(detail.data.captures ?? []), e.capture as SnapCapture],
      })
  })

  const add = () =>
    run('add', async () => {
      const r = await op<{ snap: Snap }>(
        project.id,
        'lua.snap',
        { action: 'add', file: file.trim(), line: Number(line), hits: Number(hits) },
        target,
      )
      setSel(r.snap.id)
      await list.reload()
    })
  const remove = (id: number) =>
    run(`rm${id}`, async () => {
      await op(project.id, 'lua.snap', { action: 'remove', id }, target)
      if (sel === id || !id) setSel(0)
      await list.reload()
    })

  const items = list.data?.items ?? []
  const caps = detail.data?.captures ?? []
  return (
    <Card
      title={
        <>
          <Camera className="ue:h-4 ue:w-4 ue:text-subtle" /> {t('快照点')}
        </>
      }
      aside={
        items.length > 0 && (
          <LinkBtn tone="danger" onClick={() => void remove(0)}>
            {t('全部撤掉')}
          </LinkBtn>
        )
      }
      bodyClass="ue:flex ue:flex-col"
    >
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:p-3">
        <ui.Input
          size="sm"
          className="ue:min-w-48 ue:flex-1 ue:font-mono"
          value={file}
          placeholder={t('文件或模块名，例如 UI/BagPanel.lua、UI.BagPanel')}
          onChange={(e: { target: { value: string } }) => setFile(e.target.value)}
        />
        <ui.Input
          size="sm"
          className="ue:w-20 ue:font-mono"
          value={line}
          placeholder={t('行号')}
          onChange={(e: { target: { value: string } }) => setLine(e.target.value.replace(/\D/g, ''))}
        />
        <ui.Select
          size="sm"
          className="ue:w-44"
          value={hits}
          onChange={(e: { target: { value: string } }) => setHits(e.target.value)}
          options={['1', '3', '5', '10', '20'].map((n) => ({ value: n, label: t('命中 {n} 次后撤掉', { n }) }))}
        />
        <ui.Button size="sm" disabled={busy === 'add' || !file.trim() || !Number(line)} onClick={() => void add()}>
          {t('加快照点')}
        </ui.Button>
      </div>
      {list.data?.warning && (
        <div className="ue:px-3 ue:pt-3">
          <Note>{list.data.warning}</Note>
        </div>
      )}
      <ErrorText>{list.error}</ErrorText>
      {!items.length && !list.error && (
        <p className="ue:px-3 ue:py-3 ue:text-footnote ue:text-subtle">
          {t('执行到这一行时记下局部变量和调用栈，游戏不暂停；10 分钟没命中自动撤掉。要断点调试用 IDE 里的 Lua 调试器')}
        </p>
      )}
      <div className="ue:divide-y ue:divide-line/60">
        {items.map((s) => (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={() => setSel(sel === s.id ? 0 : s.id)}
            onKeyDown={(e) => e.key === 'Enter' && setSel(sel === s.id ? 0 : s.id)}
            className={h().cn(
              'ue:flex ue:cursor-pointer ue:items-center ue:gap-2 ue:px-3 ue:py-1.5 ue:hover:bg-hover',
              sel === s.id && 'ue:bg-sel',
            )}
          >
            <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-footnote ue:text-fg" title={s.file}>
              {`${s.file}:${s.line}`}
            </span>
            <Badge tone={s.hits ? 'ok' : 'muted'}>{`${s.hits}/${s.max}`}</Badge>
            {s.active ? <Badge tone="run">{t('等待命中')}</Badge> : <Badge>{t('已撤掉')}</Badge>}
            <button
              type="button"
              title={t('删掉这个快照点和它的记录')}
              className="ue:cursor-pointer ue:rounded-md ue:p-1 ue:text-subtle ue:hover:bg-hover ue:hover:text-danger"
              onClick={(e) => {
                e.stopPropagation()
                void remove(s.id)
              }}
            >
              <Trash2 className="ue:h-3.5 ue:w-3.5" />
            </button>
          </div>
        ))}
      </div>
      {sel > 0 && (
        <div className="ue:flex ue:flex-col ue:gap-4 ue:border-t ue:border-line ue:py-3">
          <ErrorText>{detail.error}</ErrorText>
          {!caps.length && !detail.error && (
            <p className="ue:px-3 ue:text-footnote ue:text-subtle">{t('还没命中：让游戏走到这一行')}</p>
          )}
          {[...caps].reverse().map((c, i) => (
            <CaptureView key={`${c.at}-${i}`} cap={c} onOpen={open} />
          ))}
        </div>
      )}
    </Card>
  )
}
