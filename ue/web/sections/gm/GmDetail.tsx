import { Check, History, ListPlus, MessageSquarePlus, Package, Play, RotateCcw, Star, X } from 'lucide-react'
import type { LuaGmBinding, LuaGmConfig } from '../../../server/lua-gm/types.ts'
import type { GmRun } from '../../../server/store.ts'
import type { GmStore } from '../../../shared/gm/schema.ts'
import { h, t } from '../../host.ts'
import { Badge, Term } from '../../ui.tsx'
import type { GmEntry, GmParam } from './data.ts'
import { ParamField } from './ParamField.tsx'
import { preview, type RunOut } from './run.ts'

/**
 * 右边选中那条 GM 的详情（效果图 1）：参数表单、「会执行」预览、执行 / 这组参数加到常用 / 加到宏 / 发给对话，
 * 下面是这条 GM 最近几次执行，点一行把当时的参数填回去
 */
export function GmDetail({
  entry,
  moduleName,
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
  /** 归在哪个模块（GM 分类）；引擎的没有 */
  moduleName?: string
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
        {moduleName && (
          <Badge>
            <Package className="ue:mr-1 ue:inline ue:h-3 ue:w-3" />
            {moduleName}
          </Badge>
        )}
        {entry.group && entry.group !== moduleName && <Badge>{entry.group}</Badge>}
        {entry.server && <Badge tone="warn">{t('服务器执行')}</Badge>}
        <span className="ue:ml-auto ue:truncate ue:font-mono ue:text-caption ue:text-subtle" title={where}>
          {where}
        </span>
      </header>
      {/* 宽的时候左右两栏：左边参数和执行，右边输出和最近执行（用户 2026-11-16：右边大片留空、输入框拉得太宽）；窄了上下排 */}
      <div className="ue:@container ue:min-h-0 ue:flex-1 ue:overflow-auto">
        <div className="ue:grid ue:items-start ue:gap-4 ue:p-4 ue:@3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <form
            className="ue:flex ue:min-w-0 ue:flex-col ue:gap-3"
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
            <div className="ue:flex ue:flex-col ue:gap-1">
              <span className="ue:text-footnote ue:text-subtle">{t('会执行')}</span>
              {/* 调用代码可能很长（参数拼进表里），换行显示全，不截断 */}
              <code
                className={cn(
                  'ue:max-h-32 ue:overflow-auto ue:rounded-lg ue:border ue:border-line ue:bg-field ue:px-2.5 ue:py-1.5 ue:font-mono ue:text-footnote ue:break-all ue:whitespace-pre-wrap',
                  pv.error ? 'ue:text-danger' : 'ue:text-fg',
                )}
              >
                {pv.error || pv.code}
              </code>
            </div>
            <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
              <ui.Button
                size="sm"
                type="submit"
                disabled={running || !!canRun || !!pv.error}
                title={canRun || undefined}
              >
                <Play className="ue:h-3.5 ue:w-3.5" /> {t('执行')}
              </ui.Button>
              <ui.Button size="sm" variant="secondary" onClick={onFav}>
                <Star className={cn('ue:h-3.5 ue:w-3.5', fav && 'ue:fill-current ue:text-warning')} />
                {fav ? t('移出常用') : t('这组参数加到常用')}
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
            <span className="ue:text-caption ue:text-subtle">{canRun || t('Ctrl+Enter 执行')}</span>
          </form>
          <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-3">
            <section className="ue:flex ue:flex-col ue:gap-1">
              <span className="ue:text-footnote ue:text-subtle">{t('输出')}</span>
              {out ? (
                <Term className="ue:max-h-72 ue:min-h-20">
                  {out.error && <div className="ue:text-danger">{out.error}</div>}
                  {out.lines.map((l, i) => (
                    <div key={i} className="ue:whitespace-pre-wrap">
                      {l}
                    </div>
                  ))}
                  {out.ok && !out.lines.length && <div className="ue:text-term-subtle">{t('已执行（没有输出）')}</div>}
                </Term>
              ) : (
                <p className="ue:rounded-lg ue:border ue:border-dashed ue:border-line ue:px-3 ue:py-4 ue:text-center ue:text-footnote ue:text-subtle">
                  {t('执行后输出显示在这里')}
                </p>
              )}
            </section>
            <section className="ue:rounded-lg ue:border ue:border-line">
              <header className="ue:flex ue:h-8 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-3 ue:text-footnote ue:text-fg">
                <History className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
                {t('这条 GM 最近的执行')}
                {history.length > 0 && (
                  <span className="ue:ml-auto ue:text-caption ue:text-subtle">{t('点一行把参数填回去')}</span>
                )}
              </header>
              {!history.length && (
                <p className="ue:px-3 ue:py-2 ue:text-footnote ue:text-subtle">{t('还没有执行过')}</p>
              )}
              {history.slice(0, 8).map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => Array.isArray(r.args) && onArgs(r.args)}
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
                  <code className="ue:min-w-0 ue:shrink ue:truncate ue:font-mono ue:text-fg" title={r.code}>
                    {r.code}
                  </code>
                  <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-subtle">{r.out}</span>
                  <RotateCcw className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />
                </button>
              ))}
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 来源徽标：Lua 用强调色，C++、引擎用灰色 */
export const SrcBadge = ({ src }: { src: GmEntry['src'] }) => (
  <Badge tone={src === 'lua' || src === 'custom' ? 'accent' : 'muted'}>
    {src === 'lua'
      ? 'Lua'
      : src === 'cpp'
        ? 'C++'
        : src === 'console'
          ? t('控制台命令')
          : src === 'custom'
            ? t('自定义')
            : t('引擎')}
  </Badge>
)
