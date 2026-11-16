import { Check, History, ListPlus, MessageSquarePlus, Play, RotateCcw, Star, X } from 'lucide-react'
import type { LuaGmBinding, LuaGmConfig } from '../../../server/lua-gm/types.ts'
import type { GmRun } from '../../../server/store.ts'
import type { GmStore } from '../../../server/types.ts'
import { h, t } from '../../host.ts'
import { Badge, Term } from '../../ui.tsx'
import type { GmEntry, GmParam } from './data.ts'
import { SrcBadge } from './GmList.tsx'
import { ParamField } from './ParamField.tsx'
import { preview, type RunOut } from './run.ts'

/**
 * 右边选中那条 GM 的详情（效果图 1）：参数表单、「会执行」预览、执行 / 收藏这组参数 / 加到宏 / 发给对话，
 * 下面是这条 GM 最近几次执行，点一行把当时的参数填回去
 */
export function GmDetail({
  entry,
  args,
  onArg,
  onArgs,
  config,
  gm,
  onRun,
  running,
  out,
  canRun,
  history,
  fav,
  onFav,
  onMacro,
  toChat,
  onEditBinding,
}: {
  entry: GmEntry
  args: string[]
  onArg: (i: number, v: string) => void
  onArgs: (a: string[]) => void
  config?: LuaGmConfig
  gm: GmStore
  onRun: () => void
  running: boolean
  out?: RunOut
  /** 不能执行的原因（UE 没在运行），空串表示能执行 */
  canRun: string
  history: GmRun[]
  fav: boolean
  onFav: () => void
  onMacro: () => void
  toChat?: (text: string) => void
  onEditBinding: (p: GmParam, current?: LuaGmBinding) => void
}) {
  const { ui, cn } = h()
  const pv = preview(entry, args)
  const where = entry.src === 'lua' ? `${entry.file}:${entry.line}` : entry.owner
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <header className="ue:flex ue:min-h-10 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-1.5">
        <span className="ue:truncate ue:font-mono ue:text-body ue:font-medium ue:text-fg">{entry.name}</span>
        <SrcBadge src={entry.src} />
        {entry.group && <Badge>{entry.group}</Badge>}
        {entry.server && <Badge tone="warn">{t('服务器执行')}</Badge>}
        <span className="ue:ml-auto ue:truncate ue:font-mono ue:text-caption ue:text-subtle" title={where}>
          {where}
        </span>
      </header>
      <form
        className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-3 ue:overflow-auto ue:p-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!canRun && !pv.error) onRun()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !canRun && !pv.error) {
            e.preventDefault()
            onRun()
          }
        }}
      >
        {entry.desc && <p className="ue:text-body ue:text-muted">{entry.desc}</p>}
        {entry.params.map((p, i) => (
          <ParamField
            key={p.name}
            entry={entry}
            p={p}
            value={args[i] ?? ''}
            onChange={(v) => onArg(i, v)}
            config={config}
            gm={gm}
            onEditBinding={onEditBinding}
          />
        ))}
        {!entry.params.length && <p className="ue:text-footnote ue:text-subtle">{t('没有参数')}</p>}
        <div className="ue:grid ue:grid-cols-[minmax(96px,30%)_1fr] ue:items-center ue:gap-3">
          <span className="ue:text-footnote ue:text-subtle">{t('会执行')}</span>
          <code
            className={cn(
              'ue:min-w-0 ue:truncate ue:rounded-lg ue:border ue:border-line ue:bg-field ue:px-2.5 ue:py-1.5 ue:font-mono ue:text-footnote',
              pv.error ? 'ue:text-danger' : 'ue:text-fg',
            )}
            title={pv.error || pv.code}
          >
            {pv.error || pv.code}
          </code>
        </div>
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
          <ui.Button size="sm" type="submit" disabled={running || !!canRun || !!pv.error} title={canRun || undefined}>
            <Play className="ue:h-3.5 ue:w-3.5" /> {t('执行')}
          </ui.Button>
          <span className="ue:text-caption ue:text-subtle">{canRun || 'Ctrl+Enter'}</span>
          <ui.Button size="sm" variant="secondary" onClick={onFav}>
            <Star className={cn('ue:h-3.5 ue:w-3.5', fav && 'ue:fill-current ue:text-warning')} />
            {fav ? t('取消收藏') : t('收藏这组参数')}
          </ui.Button>
          <ui.Button size="sm" variant="secondary" onClick={onMacro}>
            <ListPlus className="ue:h-3.5 ue:w-3.5" /> {t('加到宏')}
          </ui.Button>
          {toChat && (
            <ui.Button
              size="sm"
              variant="secondary"
              onClick={() =>
                toChat(
                  `${entry.src === 'lua' ? 'Lua GM' : 'GM'} ${entry.name}（${where}）\n${t('执行')}：${pv.code}${
                    out ? `\n${out.ok ? out.lines.join('\n') : out.error}` : ''
                  }`,
                )
              }
            >
              <MessageSquarePlus className="ue:h-3.5 ue:w-3.5" /> {t('发给对话')}
            </ui.Button>
          )}
        </div>
        {out && (
          <Term className="ue:max-h-60">
            {out.error && <div className="ue:text-danger">{out.error}</div>}
            {out.lines.map((l, i) => (
              <div key={i} className="ue:whitespace-pre-wrap">
                {l}
              </div>
            ))}
            {out.ok && !out.lines.length && <div className="ue:text-term-subtle">{t('已执行（没有输出）')}</div>}
          </Term>
        )}
        {history.length > 0 && (
          <section className="ue:rounded-lg ue:border ue:border-line">
            <header className="ue:flex ue:h-8 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-3 ue:text-footnote ue:text-fg">
              <History className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
              {t('这条 GM 最近的执行')}
              <span className="ue:ml-auto ue:text-caption ue:text-subtle">{t('点一行把参数填回去')}</span>
            </header>
            {history.slice(0, 6).map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onArgs(r.args)}
                className="ue:flex ue:h-8 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:border-b ue:border-line/60 ue:px-3 ue:text-left ue:text-footnote ue:last:border-b-0 ue:hover:bg-hover"
              >
                <span className="ue:w-14 ue:shrink-0 ue:text-caption ue:text-subtle ue:tabular-nums">
                  {new Date(r.at).toLocaleTimeString()}
                </span>
                {r.ok ? (
                  <Check className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-success" />
                ) : (
                  <X className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-danger" />
                )}
                <code className="ue:shrink-0 ue:font-mono ue:text-fg">{r.code}</code>
                <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-subtle">{r.out}</span>
                <RotateCcw className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />
              </button>
            ))}
          </section>
        )}
      </form>
    </div>
  )
}
