import { BookmarkPlus, Play, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { SnippetView } from '../../../server/lua-debug/snippets.ts'
import { pget, ppost, useAction, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Badge, Card, ErrorText } from '../../ui.tsx'

/**
 * 执行页签右侧的「片段」（设计稿四.4「已批准的片段」）：常用代码存成有名字的片段，点一下填回编辑框或直接执行；
 * 你批准过的，Agent 用 ue_lua action=exec snippet=名字 执行时不再逐次确认。批准只记在本机，代码改了自动失效
 */
export function LuaSnippets({
  code,
  self,
  onPick,
  onRun,
  cantRun,
}: {
  code: string
  self: string
  /** 点片段：把代码和 self 填回执行框 */
  onPick: (s: SnippetView) => void
  /** 执行完把结果交给执行页显示 */
  onRun: (s: SnippetView, r: Promise<Record<string, unknown>>) => void
  /** 不能执行的原因（UE 没在运行），空串表示能执行：片段照样能看、能改 */
  cantRun?: string
}) {
  const { project } = useUe()
  const { busy, run } = useAction()
  const list = useLoad(() => pget<{ items: SnippetView[]; file: string }>(project.id, 'lua/snippets'), [project.id])
  const [editing, setEditing] = useState<{ oldName?: string; name: string; desc: string } | null>(null)
  const edit = (b: Record<string, unknown>) =>
    run('edit', async () =>
      list.setData(await ppost<{ items: SnippetView[]; file: string }>(project.id, 'lua/snippets', b)),
    )

  const items = list.data?.items ?? []
  return (
    <Card
      className="ue:w-72 ue:shrink-0"
      title={t('片段')}
      aside={
        <button
          type="button"
          disabled={!code.trim()}
          title={t('把编辑框里的代码存成片段')}
          className="ue:inline-flex ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded-md ue:px-1.5 ue:py-0.5 ue:text-footnote ue:text-accent-text ue:hover:bg-hover ue:disabled:opacity-50"
          onClick={() => setEditing({ name: '', desc: '' })}
        >
          <BookmarkPlus className="ue:h-3.5 ue:w-3.5" /> {t('存成片段')}
        </button>
      }
      bodyClass="ue:flex ue:min-h-0 ue:flex-col ue:overflow-auto"
    >
      <ErrorText>{list.error}</ErrorText>
      {!items.length && !list.error && (
        <p className="ue:p-3 ue:text-footnote ue:text-subtle">
          {t('把常用代码存成片段；批准过的片段，Agent 按名字执行时不再逐次请你确认')}
        </p>
      )}
      <div className="ue:divide-y ue:divide-line/60">
        {items.map((s) => (
          <div key={s.name} className="ue:group ue:flex ue:flex-col ue:gap-1 ue:px-3 ue:py-2 ue:hover:bg-hover">
            <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
              <button
                type="button"
                className="ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:truncate ue:text-left ue:text-footnote ue:font-medium ue:text-fg"
                title={t('填回编辑框')}
                onClick={() => onPick(s)}
              >
                {s.name}
              </button>
              {s.approved && (
                <Badge tone="ok" title={t('Agent 按名字执行时不再逐次确认')}>
                  {t('已批准')}
                </Badge>
              )}
            </div>
            {s.desc && <div className="ue:truncate ue:text-caption ue:text-subtle">{s.desc}</div>}
            <div className="ue:truncate ue:font-mono ue:text-caption ue:text-muted" title={s.code}>
              {s.code.split('\n')[0]}
            </div>
            <div className="ue:flex ue:items-center ue:gap-1">
              <SmallBtn
                icon={Play}
                label={t('执行')}
                title={cantRun || undefined}
                disabled={!!cantRun || !!busy}
                onClick={() => onRun(s, ppost(project.id, 'lua/snippets/run', { name: s.name }))}
              />
              <SmallBtn
                icon={ShieldCheck}
                label={s.approved ? t('撤销批准') : t('批准')}
                title={
                  s.approved
                    ? t('撤销后 Agent 执行它要逐次请你确认')
                    : t('批准后 Agent 按名字执行它不再逐次确认（只记在本机，代码改了自动失效）')
                }
                disabled={!!busy}
                onClick={() => void edit({ action: 'approve', name: s.name, on: !s.approved })}
              />
              <SmallBtn
                icon={Trash2}
                label={t('删除')}
                danger
                disabled={!!busy}
                onClick={() => void edit({ action: 'remove', name: s.name })}
              />
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <SaveDialog
          initial={editing}
          exists={(n) => items.some((x) => x.name === n)}
          onClose={() => setEditing(null)}
          onSave={(name, desc, approve) =>
            void edit({ action: 'save', name, desc, code, self, approve }).then(() => setEditing(null))
          }
        />
      )}
    </Card>
  )
}

function SmallBtn({
  icon: Icon,
  label,
  title,
  onClick,
  disabled,
  danger,
}: {
  icon: typeof Play
  label: string
  title?: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={h().cn(
        'ue:inline-flex ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded-md ue:px-1.5 ue:py-0.5 ue:text-caption ue:hover:bg-sel ue:disabled:opacity-50',
        danger ? 'ue:text-danger' : 'ue:text-muted',
      )}
    >
      <Icon className="ue:h-3 ue:w-3" /> {label}
    </button>
  )
}

function SaveDialog({
  initial,
  exists,
  onClose,
  onSave,
}: {
  initial: { name: string; desc: string }
  exists: (name: string) => boolean
  onClose: () => void
  onSave: (name: string, desc: string, approve: boolean) => void
}) {
  const { ui } = h()
  const [name, setName] = useState(initial.name)
  const [desc, setDesc] = useState(initial.desc)
  const [approve, setApprove] = useState(false)
  const n = name.trim()
  return (
    <ui.Modal
      open
      size="sm"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('存成片段')}
      footer={
        <>
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button disabled={!n} onClick={() => onSave(n, desc, approve)}>
            {exists(n) ? t('覆盖同名片段') : t('保存')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-4">
        <ui.Field label={t('名字')} hint={t('Agent 按这个名字执行')}>
          <ui.Input
            value={name}
            placeholder={t('刷新背包界面')}
            onChange={(e: { target: { value: string } }) => setName(e.target.value)}
          />
        </ui.Field>
        <ui.Field label={t('说明（可选）')}>
          <ui.Input value={desc} onChange={(e: { target: { value: string } }) => setDesc(e.target.value)} />
        </ui.Field>
        <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-2 ue:text-footnote ue:text-muted">
          <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} />
          {t('批准：Agent 按名字执行时不再逐次确认（只记在本机）')}
        </label>
      </div>
    </ui.Modal>
  )
}
