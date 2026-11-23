import {
  CircleAlert,
  Copy,
  FileCode,
  Hammer,
  RefreshCw,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Square,
} from 'lucide-react'
import { useRef } from 'react'
import type { LuaBuildError } from '../../../server/types.ts'
import { useAction } from '../../api.ts'
import { useToChat } from '../../chat.tsx'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { PANE_FILL, PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '@panel/web/src/components/ui/split-pane'
import { Badge, Card, ErrorText, LinkBtn, Note, Term } from '../../ui.tsx'
import { BuildOutput, BuildStatus, buildTitle } from './BuildParts.tsx'
import { useLuaBuild } from './build-store.ts'

/**
 * Lua 页「编译」页签（设计稿四.3，效果图 7）：左边改过的文件（可以勾掉不编的）和设置里的两条指令，
 * 右边这次编译的结果：认出来的 文件:行（点了用编辑器打开到那一行、每条能交给 Agent）、实时输出。
 * 编译在面板服务端起进程，不经过 UE，所以 UE 没开也能用（tabs.ts 里 offline）
 */
export function LuaBuild() {
  const { project, go } = useUe()
  const b = useLuaBuild(project.id)
  const { busy, run } = useAction()
  const chat = useToChat()
  const pane = usePane('lua-build', '34%', 300)
  const left = useRef<HTMLElement>(null)
  const { ui, cn, toast } = h()
  const snap = b.snap
  const cur = snap?.current
  const cfg = snap?.config

  if (!snap)
    return (
      <div className="ue:p-6">
        {b.error ? <ErrorText>{b.error}</ErrorText> : <ui.EmptyPanel>{t('读取中…')}</ui.EmptyPanel>}
      </div>
    )

  const open = (e: LuaBuildError) =>
    run(`open:${e.file}:${e.line}`, async () => {
      await b.open(e.file, e.line)
    })
  const errorText = (list: LuaBuildError[]) =>
    // 交给 Agent 的提示词不翻译（面板硬规则）
    'Lua 编译报错，请按 文件:行 修好，改完用 ue_lua action=compile 再编一次确认：' +
    '\n' +
    list.map((e) => `- ${e.file}:${e.line}${e.col ? `:${e.col}` : ''}: ${e.message}`).join('\n') +
    (cur ? `\n\n编译命令：${cur.command}\n完整输出：${cur.logFile}` : '')
  const changes = snap.changes
  const last = changes.last.full

  return (
    <div className={SPLIT_ROW}>
      <section
        ref={left}
        className={cn(PANE_FIXED, 'ue:flex ue:min-h-0 ue:flex-col ue:divide-y ue:divide-line')}
        style={pane.style('calc(100% - 420px)')}
      >
        <Card
          className="ue:min-h-48 ue:flex-1"
          title={t('改过的文件')}
          aside={
            <>
              <span>{t('上次编译成功后 · 按文件时间')}</span>
              <ui.IconButton
                icon={RefreshCw}
                size="xs"
                label={t('重新找改过的文件')}
                disabled={b.loading}
                onClick={() => void b.reload()}
              />
            </>
          }
          bodyClass="ue:overflow-auto"
        >
          {!snap.scriptDirExists ? (
            <div className="ue:p-3">
              <Note>{t('脚本目录 {dir} 不存在：到设置里改「Lua 脚本目录」', { dir: cfg?.scriptDir ?? '' })}</Note>
            </div>
          ) : changes.baseline === null ? (
            <div className="ue:p-3">
              <Note tone="info">{t('还没有编译成功的记录：先全编译一次，之后这里列出改过的文件')}</Note>
            </div>
          ) : !changes.files.length ? (
            <div className="ue:p-4 ue:text-footnote ue:text-subtle">
              {t('上次编译成功以来没有改过的 .lua（共 {n} 个文件）', { n: changes.total })}
            </div>
          ) : (
            <ul className="ue:py-1">
              {changes.files.map((f) => {
                const on = !b.skipped.has(f.path)
                return (
                  <li key={f.path}>
                    <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-2 ue:px-4 ue:py-1.5 ue:hover:bg-hover">
                      <input
                        type="checkbox"
                        className="ue:accent-(--accent)"
                        checked={on}
                        onChange={(e) => b.toggle(f.path, e.target.checked)}
                      />
                      <FileCode className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
                      <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-footnote" title={f.path}>
                        {f.path}
                      </span>
                      {f.p4 && <Badge tone="accent">{t('已签出')}</Badge>}
                      <span className="ue:shrink-0 ue:font-mono ue:text-caption ue:text-subtle">
                        {new Date(f.mtime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {changes.p4Error && (
            <div className="ue:px-4 ue:pb-3">
              <ErrorText>{t('P4 签出的文件没取到：{msg}', { msg: changes.p4Error })}</ErrorText>
            </div>
          )}
        </Card>
        <Card
          title={t('指令')}
          aside={
            <ui.Button size="sm" variant="ghost" onClick={() => go('bridge')}>
              <SlidersHorizontal className="ue:h-3.5 ue:w-3.5" /> {t('改设置')}
            </ui.Button>
          }
        >
          <dl className="ue:grid ue:grid-cols-[auto_1fr] ue:gap-x-4 ue:gap-y-1.5 ue:px-4 ue:py-3 ue:text-footnote">
            {(
              [
                [t('全编译'), cfg?.full || t('没配')],
                [t('增量'), cfg?.incremental || t('没配')],
                [t('目录'), cfg?.cwd || t('<项目>')],
                [t('报错格式'), cfg?.errorFormat ?? ''],
                [t('编完'), cfg?.autoReload ? t('自动重载改过的模块') : t('不重载')],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="ue:contents">
                <dt className="ue:text-subtle">{k}</dt>
                <dd className="ue:min-w-0 ue:truncate ue:font-mono" title={v}>
                  {v}
                </dd>
              </div>
            ))}
          </dl>
          {last && (
            <div className="ue:border-t ue:border-line ue:px-4 ue:py-2 ue:text-caption ue:text-subtle">
              {t('上次全编译 {at} · {n} 个文件 · {s} 秒 · {r}', {
                at: new Date(last.at).toLocaleString([], {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                n: last.files,
                s: Math.round(last.ms / 1000),
                r: last.ok ? t('成功') : t('失败'),
              })}
            </div>
          )}
        </Card>
      </section>
      <SplitHandle pane={pane} paneRef={left} reserve={() => 420} />
      <Card
        className={cn(PANE_FILL, 'ue:flex ue:min-h-0 ue:flex-col')}
        title={
          cur ? (
            <>
              <BuildStatus run={cur} />
              <span className="ue:truncate">{buildTitle(cur)}</span>
            </>
          ) : (
            t('还没编译过')
          )
        }
        aside={cur && <BuildStatus run={cur} meta />}
        bodyClass="ue:flex ue:min-h-0 ue:flex-col"
      >
        {!cur ? (
          <div className="ue:flex ue:flex-1 ue:flex-col ue:items-center ue:justify-center ue:gap-3 ue:p-6 ue:text-footnote ue:text-subtle">
            <Hammer className="ue:h-6 ue:w-6" />
            {cfg?.full || cfg?.incremental
              ? t('点页头的「增量编译」或「全编译」开始；输出会实时显示在这里')
              : t('先在设置里配全编译、增量编译两条指令')}
          </div>
        ) : (
          <>
            {cur.errors.length > 0 && (
              <div className="ue:max-h-[40%] ue:shrink-0 ue:overflow-auto ue:border-b ue:border-line">
                <div className="ue:px-4 ue:pt-2 ue:pb-1 ue:text-caption ue:text-subtle">
                  {t('{n} 个错误（按报错格式从输出里认出来，点了用编辑器打开到那一行）', { n: cur.errors.length })}
                </div>
                <ul>
                  {cur.errors.map((e) => (
                    <li
                      key={`${e.file}:${e.line}:${e.message}`}
                      className="ue:flex ue:items-start ue:gap-2 ue:border-t ue:border-line ue:px-4 ue:py-1.5 ue:first:border-t-0"
                    >
                      <CircleAlert className="ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-danger" />
                      <button
                        type="button"
                        disabled={!e.exists || !!busy}
                        title={e.exists ? t('用编辑器打开到这一行') : t('磁盘上没找到这个文件')}
                        onClick={() => void open(e)}
                        className="ue:shrink-0 ue:cursor-pointer ue:font-mono ue:text-footnote ue:text-accent-text ue:hover:underline ue:disabled:cursor-default ue:disabled:text-subtle ue:disabled:no-underline"
                      >
                        {`${e.file}:${e.line}`}
                      </button>
                      <span className="ue:min-w-0 ue:flex-1 ue:font-mono ue:text-footnote ue:break-all">
                        {e.message}
                      </span>
                      {chat.available && (
                        <LinkBtn onClick={() => chat.send(errorText([e]))}>
                          <Sparkles className="ue:h-3.5 ue:w-3.5" /> {t('交给 Agent')}
                        </LinkBtn>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {cur.reload && (
              <div className="ue:shrink-0 ue:border-b ue:border-line ue:px-4 ue:py-2">
                <Note tone={cur.reload.ok ? 'info' : 'warn'}>{cur.reload.message}</Note>
              </div>
            )}
            <div className="ue:shrink-0 ue:px-4 ue:pt-2 ue:pb-1 ue:text-caption ue:text-subtle">{t('输出')}</div>
            <Term follow className="ue:min-h-40 ue:flex-1">
              <BuildOutput run={cur} />
            </Term>
            <div className="ue:flex ue:shrink-0 ue:flex-wrap ue:items-center ue:gap-2 ue:border-t ue:border-line ue:px-4 ue:py-2">
              <ui.Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void navigator.clipboard.writeText(cur.lines.join('\n')).then(
                    () => toast.success(t('已复制')),
                    (e: Error) => toast.error(e.message),
                  )
                }
              >
                <Copy className="ue:h-3.5 ue:w-3.5" /> {t('复制输出')}
              </ui.Button>
              {b.running ? (
                <ui.Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === 'stop'}
                  onClick={() => void run('stop', () => b.stop())}
                >
                  <Square className="ue:h-3.5 ue:w-3.5" /> {t('停止')}
                </ui.Button>
              ) : (
                <ui.Button
                  size="sm"
                  variant="secondary"
                  disabled={!!busy}
                  onClick={() => void run('again', () => b.start(cur.mode))}
                >
                  <RotateCw className="ue:h-3.5 ue:w-3.5" /> {t('再编一次')}
                </ui.Button>
              )}
              {chat.available && cur.errors.length > 0 && !b.running && (
                <ui.Button size="sm" className="ue:ml-auto" onClick={() => chat.send(errorText(cur.errors))}>
                  <Sparkles className="ue:h-3.5 ue:w-3.5" /> {t('把 {n} 个错误交给 Agent 修', { n: cur.errors.length })}
                </ui.Button>
              )}
            </div>
          </>
        )}
      </Card>
      {chat.dialog}
    </div>
  )
}
