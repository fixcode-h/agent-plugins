import { RotateCcw, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { GmStore, HistoryItem } from '../../server/types.ts'
import { op, pget, ppost, useAction, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { PANE_FIXED, SplitHandle, usePane } from '../split.tsx'
import { Badge, Card, Confirm, PageHead, SearchBox, TargetPicker, Term } from '../ui.tsx'

interface CVar {
  name: string
  help: string
  kind: 'var' | 'cmd'
  value?: string
  setBy?: string
}
interface Entry {
  cmd: string
  out: string[]
  error?: string
  world?: string
}

/** 屏幕上最多留多少条命令的输出：长时间用控制台时不让 DOM 越来越大 */
const MAX_ENTRIES = 200

/**
 * 控制台（图 2）：深色终端区显示命令和输出；↑↓ 翻历史；Tab 按前缀补全（按下 Tab 才查，不边打边查）；
 * 危险命令先确认；右栏是控制台变量，默认只看改过的，可以改和还原
 */
export function Console() {
  const { project, target } = useUe()
  const { cn, toast } = h()
  const { busy, run } = useAction()
  const [entries, setEntries] = useState<Entry[]>([])
  // 右边控制台变量栏的宽度可拖；左边终端至少留 360px
  const pane = usePane('console', '384px', 260)
  const vars = useRef<HTMLElement>(null)
  const [input, setInput] = useState('')
  const [hi, setHi] = useState(-1)
  const [completions, setCompletions] = useState<CVar[]>([])
  const [pending, setPending] = useState<{ cmd: string; rule: string }>()
  const [query, setQuery] = useState('')
  const local = useLoad(() => pget<{ console: string[] }>(project.id, 'local'), [project.id])
  const gm = useLoad(() => pget<GmStore>(project.id, 'gm'), [project.id])
  const cvars = useLoad(
    () =>
      op<{ items: CVar[]; total: number }>(
        project.id,
        'cvars',
        query ? { query, prefix: false, limit: 100 } : { changed: true, limit: 200 },
        target,
      ),
    [project.id, query, target.instance],
  )
  const hist = useLoad(() => pget<{ items: HistoryItem[] }>(project.id, 'history'), [project.id])
  const end = useRef<HTMLDivElement>(null)
  // 花括号不能省：新版 Chromium 的 scrollIntoView 返回 Promise，直接当返回值会被 React 当成清理函数调用而报错
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [entries])
  const history = local.data?.console ?? []

  const exec = (cmd: string, confirmed = false) =>
    run('exec', async () => {
      const r = await ppost<{ needConfirm?: boolean; rule?: string; output?: string[]; world?: string }>(
        project.id,
        'console',
        {
          command: cmd,
          target,
          confirmed,
        },
      ).catch((e: Error) => ({ error: e.message }) as { error: string })
      if ('needConfirm' in r && r.needConfirm) return setPending({ cmd, rule: r.rule ?? '' })
      const e: Entry =
        'error' in r
          ? { cmd, out: [], error: String(r.error) }
          : { cmd, out: (r as { output?: string[] }).output ?? [], world: (r as { world?: string }).world }
      setEntries((x) => [...x, e].slice(-MAX_ENTRIES))
      setInput('')
      setHi(-1)
      setCompletions([])
      local.setData({ console: [...history.filter((c) => c !== cmd), cmd] })
      if (/^\S+\s/.test(cmd)) void cvars.reload()
    })

  const complete = async () => {
    const q = input.trim()
    if (!q) return
    const r = await op<{ items: CVar[] }>(project.id, 'cvars', { query: q, limit: 30 }, target).catch(() => ({
      items: [],
    }))
    if (r.items.length === 1) setInput(`${r.items[0].name} `)
    setCompletions(r.items)
  }

  const favs = gm.data?.favConsole ?? []
  const toggleFav = (cmd: string) =>
    run('fav', async () => {
      const g = gm.data ?? { presets: [], macros: [], favConsole: [], favGm: [] }
      const next = { ...g, favConsole: favs.includes(cmd) ? favs.filter((c) => c !== cmd) : [...favs, cmd] }
      await ppost(project.id, 'gm', next)
      gm.setData(next)
    })

  // 「还原」：找这个变量最早一次还没撤回的修改，撤回到那之前的值
  const restoreOf = (name: string) =>
    [...(hist.data?.items ?? [])]
      .reverse()
      .find((i) => i.op === 'cvar.set' && i.undo && !i.undone && i.summary.startsWith(`${name} =`))

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title={t('控制台')} desc={t('输出只截这条命令执行期间的日志')}>
        <TargetPicker />
      </PageHead>
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-4 ue:p-6 ue:lg:flex-row ue:lg:gap-0">
        <div className="ue:flex ue:min-h-80 ue:min-w-0 ue:flex-1 ue:flex-col ue:gap-3">
          <Term className="ue:min-h-0 ue:flex-1">
            {!entries.length && <div className="ue:text-term-subtle">{t('输入命令回车执行；↑↓ 翻历史，Tab 补全')}</div>}
            {entries.map((e, i) => (
              <div key={i} className="ue:group ue:mb-2">
                <div className="ue:flex ue:items-center ue:gap-2">
                  <span className="ue:text-term-prompt">&gt;</span>
                  <span className="ue:text-term-cmd">{e.cmd}</span>
                  {e.world && <span className="ue:text-term-subtle">· {e.world}</span>}
                  <button
                    type="button"
                    title={t('收藏')}
                    onClick={() => void toggleFav(e.cmd)}
                    className="ue:ml-auto ue:cursor-pointer ue:text-term-subtle ue:opacity-0 ue:group-hover:opacity-100 ue:hover:text-term-fg"
                  >
                    <Star
                      className={cn('ue:h-3.5 ue:w-3.5', favs.includes(e.cmd) && 'ue:fill-current ue:text-warning')}
                    />
                  </button>
                </div>
                {e.error && <div className="ue:whitespace-pre-wrap ue:text-danger">{e.error}</div>}
                {e.out.map((l, j) => (
                  <div key={j} className="ue:whitespace-pre-wrap ue:break-all">
                    {l}
                  </div>
                ))}
                {!e.error && !e.out.length && <div className="ue:text-term-subtle">{t('（没有输出）')}</div>}
              </div>
            ))}
            <div ref={end} />
          </Term>
          {completions.length > 1 && (
            <ul className="ue:max-h-48 ue:overflow-auto ue:rounded-xl ue:border ue:border-pop-edge ue:bg-card ue:py-1 ue:shadow-pop">
              {completions.map((c) => (
                <li key={c.name}>
                  <button
                    type="button"
                    onClick={() => {
                      setInput(`${c.name} `)
                      setCompletions([])
                    }}
                    className="ue:flex ue:w-full ue:cursor-pointer ue:items-baseline ue:gap-3 ue:px-3 ue:py-1 ue:text-left ue:hover:bg-hover"
                  >
                    <span className="ue:font-mono ue:text-footnote ue:text-fg">{c.name}</span>
                    {c.kind === 'var' && (
                      <span className="ue:font-mono ue:text-footnote ue:text-accent-text">{c.value}</span>
                    )}
                    <span className="ue:min-w-0 ue:truncate ue:text-caption ue:text-subtle">{c.help}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (input.trim()) void exec(input.trim())
            }}
            className="ue:flex ue:items-center ue:gap-2 ue:rounded-xl ue:border ue:border-line-strong ue:bg-field ue:px-3 ue:focus-within:border-focus"
          >
            <span className="ue:font-mono ue:text-body ue:text-subtle">&gt;</span>
            <input
              value={input}
              disabled={busy === 'exec'}
              onChange={(e) => setInput(e.target.value)}
              aria-label={t('控制台命令')}
              placeholder={t('控制台命令，例如 stat unit')}
              onKeyDown={(e) => {
                if (e.key === 'Tab') {
                  e.preventDefault()
                  void complete()
                } else if (e.key === 'ArrowUp' && history.length) {
                  e.preventDefault()
                  const n = hi < 0 ? history.length - 1 : Math.max(0, hi - 1)
                  setHi(n)
                  setInput(history[n])
                } else if (e.key === 'ArrowDown' && hi >= 0) {
                  e.preventDefault()
                  const n = hi + 1
                  setHi(n >= history.length ? -1 : n)
                  setInput(n >= history.length ? '' : history[n])
                } else if (e.key === 'Escape') setCompletions([])
              }}
              className="ue:h-10 ue:min-w-0 ue:flex-1 ue:bg-transparent ue:font-mono ue:text-body ue:text-fg ue:outline-none ue:placeholder:text-subtle"
            />
          </form>
        </div>

        <SplitHandle pane={pane} paneRef={vars} side="right" reserve={() => 376} />
        <Card
          ref={vars}
          className={cn('ue:max-h-full', PANE_FIXED)}
          style={pane.style('calc(100% - 376px)')}
          bodyClass="ue:flex ue:flex-col ue:min-h-0"
          title={t('控制台变量')}
          aside={query ? t('搜索结果 {n}', { n: cvars.data?.total ?? 0 }) : t('只看改过的')}
        >
          <div className="ue:border-b ue:border-line ue:p-3">
            <SearchBox placeholder={t('变量名包含…')} onSearch={setQuery} allowEmpty busy={cvars.loading} />
          </div>
          {cvars.error && <p className="ue:p-3 ue:text-footnote ue:text-danger">{cvars.error}</p>}
          <ul className="ue:min-h-0 ue:flex-1 ue:divide-y ue:divide-line ue:overflow-auto">
            {(cvars.data?.items ?? [])
              .filter((c) => c.kind === 'var')
              .map((c) => {
                const r = restoreOf(c.name)
                return (
                  <li key={c.name} className="ue:flex ue:flex-col ue:gap-1 ue:px-3 ue:py-2">
                    <div className="ue:flex ue:items-center ue:gap-2">
                      <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-footnote ue:text-fg" title={c.help}>
                        {c.name}
                      </span>
                      {c.setBy && <Badge tone={c.setBy === 'Console' ? 'accent' : 'muted'}>{c.setBy}</Badge>}
                      {r && (
                        <button
                          type="button"
                          title={t('还原到改之前：{v}', { v: String(r.prev ?? '') })}
                          onClick={() =>
                            void run(r.id, () =>
                              ppost(project.id, 'undo', { id: r.id }).then(() => {
                                void cvars.reload()
                                void hist.reload()
                              }),
                            )
                          }
                          className="ue:ml-auto ue:cursor-pointer ue:text-subtle ue:hover:text-fg"
                        >
                          <RotateCcw className="ue:h-3.5 ue:w-3.5" />
                        </button>
                      )}
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        const v = String(new FormData(e.currentTarget).get('v') ?? '')
                        void run(c.name, async () => {
                          await op(project.id, 'cvar.set', { name: c.name, value: v }, target)
                          toast.success(`${c.name} = ${v}`)
                          void cvars.reload()
                          void hist.reload()
                        })
                      }}
                    >
                      <input
                        name="v"
                        defaultValue={c.value}
                        key={c.value}
                        aria-label={c.name}
                        className="ue:h-7 ue:w-full ue:rounded-md ue:border ue:border-line ue:bg-field ue:px-2 ue:font-mono ue:text-footnote ue:text-fg ue:outline-none ue:focus:border-focus"
                      />
                    </form>
                  </li>
                )
              })}
            {cvars.data && !cvars.data.items.length && (
              <li className="ue:p-4 ue:text-center ue:text-footnote ue:text-subtle">
                {query ? t('没有匹配的变量') : t('没有改过的变量')}
              </li>
            )}
          </ul>
        </Card>
      </div>
      <Confirm
        open={!!pending}
        title={t('执行危险命令？')}
        okText={t('仍要执行')}
        danger
        onCancel={() => setPending(undefined)}
        onOk={() => {
          const p = pending
          setPending(undefined)
          if (p) void exec(p.cmd, true)
        }}
      >
        <p className="ue:font-mono">{pending?.cmd}</p>
        <p className="ue:mt-2 ue:text-footnote ue:text-subtle">
          {t('匹配危险命令「{rule}」，可能退出 UE、切关卡或打断 PIE。危险命令名单在插件参数里改。', {
            rule: pending?.rule ?? '',
          })}
        </p>
      </Confirm>
    </div>
  )
}
