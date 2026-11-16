import { Bot, Copy, RefreshCw, SquarePen, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { op, ppost, useAction } from '../../api.ts'
import { useToChat } from '../../chat.tsx'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useKept } from '../../keep.ts'
import { Badge, ErrorText } from '../../ui.tsx'
import { clock, sourceLabel, splitWhere, useLuaErrors, useModules, useOpenLua, type LuaError } from './lua-data.ts'

/**
 * Lua 页「报错」页签（设计稿「UE 插件优化与扩展」二 P0、效果图 5）：同一处的报错归并成一条，左边按最近出现排，
 * 右边是这条的出错源码、调用栈、局部变量。点栈里的「文件:行」用编辑器打开；「交给 Agent 修」把报错整理好放进对话草稿。
 * 数据来自 UELink 2.4 的 lua.errors（项目接了 CaptureError 时有局部变量，否则从日志里认）
 */
export function LuaErrors() {
  const { project, target } = useUe()
  const { ui, cn, toast } = h()
  const errs = useLuaErrors()
  const mods = useModules()
  const open = useOpenLua()
  const chat = useToChat()
  const { busy, run } = useAction()
  const [sel, setSel] = useKept<string | undefined>(`${project.id}/lua/errSel`, undefined)
  const items = [...(errs.data?.items ?? [])].sort((a, b) => b.last.localeCompare(a.last))
  const cur = items.find((e) => e.id === sel) ?? items[0]
  const root = mods.data?.root

  const clear = () =>
    run('clear', async () => {
      await op(project.id, 'lua.errors', { clear: true, limit: 1 }, target)
      setSel(undefined)
      void errs.reload()
    })

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2">
        <span className="ue:text-footnote ue:text-muted">
          {t('{n} 处报错，合计 {c} 次', { n: items.length, c: items.reduce((s, e) => s + e.count, 0) })}
        </span>
        <span className="ue:ml-auto" />
        <ui.IconButton icon={RefreshCw} size="sm" label={t('刷新')} onClick={() => void errs.reload()} />
        <ui.Button size="sm" variant="secondary" disabled={!items.length || busy === 'clear'} onClick={clear}>
          <Trash2 className="ue:h-3.5 ue:w-3.5" /> {t('清空')}
        </ui.Button>
      </div>
      <div className="ue:px-4">
        <ErrorText>{errs.error}</ErrorText>
      </div>
      {!items.length ? (
        <div className="ue:p-6">
          <ui.EmptyPanel>{errs.data ? t('没有 Lua 报错') : t('读取中…')}</ui.EmptyPanel>
        </div>
      ) : (
        <div className="ue:flex ue:min-h-0 ue:flex-1">
          <ul className="ue:w-[34%] ue:min-w-56 ue:shrink-0 ue:overflow-auto ue:border-r ue:border-line">
            {items.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setSel(e.id)}
                  className={cn(
                    'ue:flex ue:w-full ue:cursor-pointer ue:flex-col ue:gap-0.5 ue:border-b ue:border-line/60 ue:px-4 ue:py-2 ue:text-left',
                    e.id === cur?.id ? 'ue:bg-sel' : 'ue:hover:bg-hover',
                  )}
                >
                  <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-2">
                    <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-footnote ue:text-danger">
                      {e.message}
                    </span>
                    {e.count > 1 && <Badge tone="danger">×{e.count}</Badge>}
                  </span>
                  <span className="ue:flex ue:gap-2 ue:text-caption ue:text-subtle">
                    <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono">{e.where ?? '—'}</span>
                    <span className="ue:shrink-0">{clock(e.last)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {cur && (
            <ErrorDetail
              key={cur.id}
              e={cur}
              root={root}
              onOpen={(file) => open(file, root)}
              onChat={chat.available ? () => chat.send(chatText(cur)) : undefined}
              onCopy={() => void navigator.clipboard.writeText(chatText(cur)).then(() => toast.success(t('已复制')))}
            />
          )}
        </div>
      )}
      {chat.dialog}
    </div>
  )
}

/** 交给对话 / 复制用的整理文字：报错、位置、调用栈、局部变量 */
function chatText(e: LuaError) {
  const lines = [`Lua 报错（出现 ${e.count} 次）：${e.message}`]
  if (e.where) lines.push(`位置：${e.where}`)
  if (e.stack.length) lines.push('调用栈：', ...e.stack.map((s) => `  ${s}`))
  if (e.locals?.length) lines.push('局部变量：', ...e.locals.map((l) => `  ${l.name} = ${l.v ?? l.t}`))
  lines.push('请找到原因并修好。')
  return lines.join('\n')
}

/** 栈里的一行：「UI/BagPanel.lua:88: in function 'OnClick'」里的文件:行可以点 */
const STACK_LOC = /^(\s*)(.+?\.lua:\d+)(.*)$/

function ErrorDetail({
  e,
  root,
  onOpen,
  onChat,
  onCopy,
}: {
  e: LuaError
  root?: string
  onOpen: (file: string) => void
  onChat?: () => void
  onCopy: () => void
}) {
  const { project } = useUe()
  const { ui, cn } = h()
  const at = splitWhere(e.where)
  const [snip, setSnip] = useState<{ from: number; lines: string[] }>()
  useEffect(() => {
    if (!at) return
    // 源码片段读不到（文件挪了、在项目外）就不显示，不当成错误
    ppost<{ from: number; lines: string[] }>(project.id, 'lua/snippet', { file: at.file, line: at.line, root })
      .then(setSnip)
      .catch(() => setSnip(undefined))
    // 只在换了报错位置时读
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [e.where, root])

  return (
    <div className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col ue:overflow-auto ue:p-4">
      <p className="ue:font-mono ue:text-body ue:break-words ue:text-danger">{e.message}</p>
      <div className="ue:mt-1.5 ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:text-caption ue:text-subtle">
        <Badge tone={e.count > 1 ? 'danger' : 'muted'}>{t('{n} 次', { n: e.count })}</Badge>
        <span>{t('首次 {a} · 最近 {b}', { a: clock(e.first), b: clock(e.last) })}</span>
        <Badge>{sourceLabel(e.source)}</Badge>
      </div>
      <div className="ue:mt-3 ue:flex ue:flex-wrap ue:gap-1.5">
        {at && (
          <ui.Button size="sm" variant="secondary" onClick={() => onOpen(at.file)}>
            <SquarePen className="ue:h-3.5 ue:w-3.5" /> {t('用编辑器打开')}
          </ui.Button>
        )}
        <ui.Button size="sm" variant="secondary" onClick={onCopy}>
          <Copy className="ue:h-3.5 ue:w-3.5" /> {t('复制')}
        </ui.Button>
        {onChat && (
          <ui.Button size="sm" onClick={onChat}>
            <Bot className="ue:h-3.5 ue:w-3.5" /> {t('交给 Agent 修')}
          </ui.Button>
        )}
      </div>

      {snip && at && (
        <Section title={at.file}>
          <pre className="ue:overflow-auto ue:rounded-md ue:bg-panel ue:py-1.5 ue:font-mono ue:text-footnote">
            {snip.lines.map((l, i) => {
              const n = snip.from + i
              return (
                <div key={n} className={cn('ue:flex ue:px-2', n === at.line && 'ue:bg-danger/10')}>
                  <span className="ue:w-10 ue:shrink-0 ue:pr-2 ue:text-right ue:text-subtle ue:select-none">{n}</span>
                  <span className="ue:whitespace-pre ue:text-fg">{l}</span>
                </div>
              )
            })}
          </pre>
        </Section>
      )}

      {!!e.stack.length && (
        <Section title={t('调用栈')}>
          <div className="ue:flex ue:flex-col ue:font-mono ue:text-footnote">
            {e.stack.map((s, i) => {
              const m = STACK_LOC.exec(s)
              if (!m)
                return (
                  <span key={i} className="ue:text-muted">
                    {s}
                  </span>
                )
              return (
                <span key={i} className="ue:text-muted">
                  {m[1]}
                  <button
                    type="button"
                    onClick={() => onOpen(m[2])}
                    className="ue:cursor-pointer ue:text-accent-text ue:hover:underline"
                  >
                    {m[2]}
                  </button>
                  {m[3]}
                </span>
              )
            })}
          </div>
        </Section>
      )}

      <Section title={t('出错时的局部变量')}>
        {e.locals?.length ? (
          <div className="ue:flex ue:flex-col">
            {e.locals.map((l) => (
              <div
                key={l.name}
                className="ue:flex ue:gap-3 ue:border-b ue:border-line/60 ue:py-1 ue:font-mono ue:text-footnote"
              >
                <span className="ue:w-40 ue:shrink-0 ue:truncate ue:text-fg">{l.name}</span>
                <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-muted">
                  {l.obj ??
                    (l.v !== undefined
                      ? JSON.stringify(l.v)
                      : l.t === 'table'
                        ? `{ ${t('{n} 项', { n: l.n ?? 0 })} }`
                        : l.t)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="ue:text-caption ue:text-subtle">
            {e.source === 'log'
              ? t(
                  '这条是从日志里认出来的，没有局部变量：项目在 UnLua 的报错回调里调 FAgentPanelLua::CaptureError 后会有',
                )
              : t('没有局部变量')}
          </p>
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ue:mt-4">
      <h3 className="ue:mb-1.5 ue:truncate ue:text-caption ue:font-medium ue:text-subtle">{title}</h3>
      {children}
    </section>
  )
}

/** 页签上的报错数（红点）：没有报错时不显示数字 */
export function useErrorsBadge() {
  const errs = useLuaErrors()
  const n = errs.data?.items.length ?? 0
  return n ? { text: String(n), tone: 'danger' as const, hint: t('有 {n} 处 Lua 报错', { n }) } : undefined
}
