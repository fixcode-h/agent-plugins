import { ArrowDown, Copy, Eraser, MessageSquare, Pause, Play, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ppost } from '../api.ts'
import { useToChat } from '../chat.tsx'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { ErrorText, PageHead, SearchBox } from '../ui.tsx'
import { LineDetail, clock, collapse, lineText, type Line } from './LogParts.tsx'
import { ClearDialog, Crashes } from './LogsExtra.tsx'

interface TailRes {
  live: boolean
  lines: Line[]
  cursor: number
  dropped?: number
  errors: number
  warnings: number
  file: string
  truncated?: boolean
}

/** 网页里最多留多少行（再多的旧行丢掉）；只画看得见的几十行，日志刷屏也不卡 */
const MAX_LINES = 5000
const ROW = 20
/** 分类下拉最多列多少个（见过的分类按出现顺序） */
const MAX_CATS = 200

/**
 * 运行日志（图 9）：在跑的 UE 按游标每秒增量取（筛选在桥接里做，只传匹配的行），没在跑读日志文件；
 * 滚上去看旧行时自动暂停跟随；清空正在写的日志文件（设计文档 3.5）；崩溃记录。
 * 界面优化第 11–13 条：级别分段带计数、分类从见过的里选、时间列、PIE 开停分隔、连续重复折叠、
 * 选中行的详情条、选中后浮出「复制 / 发给对话」
 */
export function Logs() {
  const { project, sub, state } = useUe()
  const { cn, ui, toast } = h()
  const chat = useToChat()
  // 子位置 crash 直接开崩溃记录（空页面「看崩溃记录」），error 只看错误（概览的日志块）
  const [tab, setTab] = useState<'log' | 'crash'>(sub === 'crash' ? 'crash' : 'log')
  const [filter, setFilter] = useState({ category: '', verbosity: sub === 'error' ? 'Error' : '', contains: '' })
  const [lines, setLines] = useState<Line[]>([])
  const [cats, setCats] = useState<string[]>([])
  const [info, setInfo] = useState<Omit<TailRes, 'lines'>>()
  const [skipped, setSkipped] = useState(0)
  const [error, setError] = useState('')
  const [follow, setFollow] = useState(true)
  const [paused, setPaused] = useState(false)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [focus, setFocus] = useState<number>()
  const [clearOpen, setClearOpen] = useState(false)
  const cursor = useRef(0)
  const box = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState({ top: 0, height: 400 })
  const inFlight = useRef(false)

  useEffect(() => {
    if (sub === 'crash') setTab('crash')
    else if (sub === 'error') {
      setTab('log')
      setFilter((f) => ({ ...f, verbosity: 'Error' }))
    }
  }, [sub])

  // 筛选变了：从头取
  useEffect(() => {
    cursor.current = 0
    setLines([])
    setSkipped(0)
    setSel(new Set())
    setFocus(undefined)
  }, [filter, project.id])

  useEffect(() => {
    let stop = false
    const tick = async () => {
      if (stop || paused || document.hidden || inFlight.current) return
      inFlight.current = true
      try {
        const r = await ppost<TailRes>(project.id, 'logs', {
          ...filter,
          since: cursor.current,
          limit: cursor.current ? 1000 : 500,
        })
        if (stop) return
        setError('')
        const { lines: raw, ...rest } = r
        const rx = Date.now()
        const got = raw.map((l) => ({ ...l, rx }))
        setInfo(rest)
        if (got.length)
          setCats((old) => {
            const seen = new Set(old)
            const add = [...new Set(got.map((l) => l.category).filter((c) => c && !seen.has(c)))]
            return add.length ? [...old, ...add].slice(0, MAX_CATS) : old
          })
        if (!r.live) {
          // 日志文件：每次给的是尾部全量，直接替换
          setLines(got)
          cursor.current = 0
        } else {
          if (r.dropped) setSkipped((s) => s + (r.dropped ?? 0))
          if (got.length) setLines((old) => [...old, ...got].slice(-MAX_LINES))
          cursor.current = r.cursor
        }
      } catch (e) {
        if (!stop) setError((e as Error).message)
      } finally {
        inFlight.current = false
      }
    }
    void tick()
    const id = setInterval(() => void tick(), 1000)
    return () => {
      stop = true
      clearInterval(id)
    }
  }, [project.id, filter, paused])

  // PIE 开始 / 结束时在日志里插一条分隔（按面板看到的世界变化，不靠日志文字）
  const pieOn = !!state?.instances.some((i) => i.kind === 'editor' && i.worlds.some((w) => w.type === 'PIE'))
  const lastPie = useRef<boolean>(undefined)
  useEffect(() => {
    const was = lastPie.current
    lastPie.current = pieOn
    if (was === undefined || was === pieOn || !info?.live) return
    const now = Date.now()
    setLines((old) => [
      ...old,
      { seq: -now, category: '', verbosity: '', text: pieOn ? t('PIE 开始') : t('PIE 结束'), rx: now, mark: true },
    ])
    // 只跟着 PIE 状态变
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [pieOn])

  const rows = useMemo(() => collapse(lines), [lines])

  useLayoutEffect(() => {
    const el = box.current
    if (el && follow) el.scrollTop = el.scrollHeight
  }, [rows, follow])

  const onScroll = () => {
    const el = box.current
    if (!el) return
    setScroll({ top: el.scrollTop, height: el.clientHeight })
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < ROW * 2)
  }
  const first = Math.max(0, Math.floor(scroll.top / ROW) - 10)
  const last = Math.min(rows.length, Math.ceil((scroll.top + scroll.height) / ROW) + 10)

  const picked = rows.filter((r) => !r.mark && sel.has(r.seq))
  const pickedText = () => picked.map((r) => (r.count > 1 ? `${lineText(r)}  (×${r.count})` : lineText(r))).join('\n')
  const copy = () =>
    void navigator.clipboard.writeText(pickedText()).then(() => toast.success(t('已复制 {n} 行', { n: picked.length })))
  const focused = rows.find((r) => r.seq === focus && !r.mark)
  const tone = (v: string) =>
    /Error|Fatal/.test(v) ? 'ue:text-danger' : v === 'Warning' ? 'ue:text-warning' : 'ue:text-term-fg'

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead
        title={t('运行日志')}
        desc={info ? `${info.file}${info.live ? '' : ` · ${t('UE 没在运行，读的是日志文件')}`}` : undefined}
      >
        <ui.Segmented
          size="sm"
          label={t('日志 / 崩溃')}
          value={tab}
          onChange={setTab}
          options={[
            { id: 'log', label: t('日志') },
            { id: 'crash', label: t('崩溃记录') },
          ]}
        />
        {tab === 'log' && (
          <ui.Button size="sm" variant="danger-outline" onClick={() => setClearOpen(true)}>
            <Eraser className="ue:h-3.5 ue:w-3.5" /> {t('清空日志')}
          </ui.Button>
        )}
      </PageHead>
      {tab === 'crash' ? (
        <Crashes />
      ) : (
        <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
          <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2">
            <ui.Segmented
              size="sm"
              label={t('级别')}
              value={filter.verbosity}
              onChange={(v: string) => setFilter((f) => ({ ...f, verbosity: v }))}
              options={[
                { id: '', label: t('全部') },
                { id: 'Error', label: info ? t('错误 {n}', { n: info.errors }) : t('错误') },
                { id: 'Warning', label: info ? t('警告 {n}', { n: info.warnings }) : t('警告') },
              ]}
            />
            <ui.Select
              size="sm"
              className="ue:w-44"
              value={filter.category}
              onChange={(e: { target: { value: string } }) => setFilter((f) => ({ ...f, category: e.target.value }))}
              options={[
                { value: '', label: t('所有分类') },
                ...[...new Set([...cats, filter.category].filter(Boolean))].sort().map((c) => ({ value: c, label: c })),
              ]}
            />
            <div className="ue:min-w-48 ue:flex-1">
              <SearchBox
                placeholder={t('包含的文字')}
                allowEmpty
                onSearch={(c) => setFilter((f) => ({ ...f, contains: c }))}
              />
            </div>
            <ui.Button size="sm" variant="secondary" onClick={() => setPaused((p) => !p)}>
              {paused ? <Play className="ue:h-3.5 ue:w-3.5" /> : <Pause className="ue:h-3.5 ue:w-3.5" />}{' '}
              {paused ? t('继续') : t('暂停')}
            </ui.Button>
          </div>
          <ErrorText>{error}</ErrorText>
          {skipped > 0 && (
            <p className="ue:text-footnote ue:text-warning">
              {t('日志刷得太快，中间有 {n} 行来不及取，已跳过（用筛选只看需要的行）', { n: skipped })}
            </p>
          )}
          {info?.truncated && <p className="ue:text-footnote ue:text-subtle">{t('日志文件很大，只搜了最后 64 MB')}</p>}
          <div className="ue:relative ue:min-h-0 ue:flex-1">
            <div
              ref={box}
              onScroll={onScroll}
              className="ue:absolute ue:inset-0 ue:overflow-auto ue:bg-term-bg ue:font-mono ue:text-footnote"
            >
              <div style={{ height: rows.length * ROW, position: 'relative' }}>
                {rows.slice(first, last).map((l, i) =>
                  l.mark ? (
                    <div
                      key={l.seq}
                      style={{ top: (first + i) * ROW, height: ROW }}
                      className="ue:absolute ue:inset-x-0 ue:flex ue:items-center ue:gap-3 ue:px-4 ue:text-caption ue:text-term-subtle"
                    >
                      <span className="ue:h-px ue:flex-1 ue:bg-term-subtle/30" />
                      {clock(l.rx)} · {l.text}
                      <span className="ue:h-px ue:flex-1 ue:bg-term-subtle/30" />
                    </div>
                  ) : (
                    <div
                      key={l.seq}
                      onClick={(e) => {
                        setFocus(l.seq)
                        setSel((s) => {
                          const n = new Set(e.shiftKey || e.metaKey || e.ctrlKey ? s : [])
                          if (s.has(l.seq) && (e.metaKey || e.ctrlKey)) n.delete(l.seq)
                          else n.add(l.seq)
                          return n
                        })
                      }}
                      style={{ top: (first + i) * ROW, height: ROW }}
                      className={cn(
                        'ue:absolute ue:inset-x-0 ue:flex ue:cursor-default ue:gap-2 ue:truncate ue:px-4 ue:leading-5',
                        tone(l.verbosity),
                        sel.has(l.seq) && 'ue:bg-term-hover',
                      )}
                    >
                      <span className="ue:w-15 ue:shrink-0 ue:text-term-subtle">{clock(l.at ?? l.rx)}</span>
                      <span className="ue:shrink-0 ue:text-term-subtle">{l.category}</span>
                      <span className="ue:truncate">{l.text}</span>
                      {l.count > 1 && (
                        <span className="ue:ml-auto ue:shrink-0 ue:rounded ue:bg-term-hover ue:px-1.5 ue:text-caption ue:text-term-fg">
                          ×{l.count}
                        </span>
                      )}
                    </div>
                  ),
                )}
              </div>
              {!rows.length && (
                <div className="ue:absolute ue:inset-0 ue:flex ue:items-center ue:justify-center ue:text-term-subtle">
                  {t('没有日志')}
                </div>
              )}
            </div>
            {picked.length > 0 ? (
              <div className="ue:absolute ue:bottom-4 ue:left-1/2 ue:flex ue:h-9 ue:-translate-x-1/2 ue:items-center ue:gap-1 ue:rounded-full ue:border ue:border-line ue:bg-card ue:pr-1 ue:pl-3.5 ue:text-footnote ue:text-fg ue:shadow-pop">
                <span className="ue:mr-1 ue:text-muted">{t('已选 {n} 行', { n: picked.length })}</span>
                <button
                  type="button"
                  onClick={copy}
                  className="ue:flex ue:h-7 ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded-full ue:px-2.5 ue:hover:bg-hover"
                >
                  <Copy className="ue:h-3.5 ue:w-3.5" /> {t('复制')}
                </button>
                {chat.available && (
                  <button
                    type="button"
                    onClick={() => chat.send(`${t('UE 日志：')}\n\`\`\`\n${pickedText()}\n\`\`\``)}
                    className="ue:flex ue:h-7 ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded-full ue:px-2.5 ue:hover:bg-hover"
                  >
                    <MessageSquare className="ue:h-3.5 ue:w-3.5" /> {t('发给对话')}
                  </button>
                )}
                <button
                  type="button"
                  aria-label={t('取消选择')}
                  onClick={() => setSel(new Set())}
                  className="ue:flex ue:h-7 ue:w-7 ue:cursor-pointer ue:items-center ue:justify-center ue:rounded-full ue:text-subtle ue:hover:bg-hover"
                >
                  <X className="ue:h-3.5 ue:w-3.5" />
                </button>
              </div>
            ) : (
              !follow && (
                <button
                  type="button"
                  onClick={() => setFollow(true)}
                  className="ue:absolute ue:right-4 ue:bottom-4 ue:flex ue:h-7 ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded-full ue:bg-card ue:px-3 ue:text-footnote ue:text-fg ue:shadow-pop"
                >
                  <ArrowDown className="ue:h-3.5 ue:w-3.5" /> {t('回到最新')}
                </button>
              )
            )}
          </div>
          {focused && <LineDetail line={focused} />}
        </div>
      )}
      {clearOpen && (
        <ClearDialog
          onClose={() => setClearOpen(false)}
          onDone={() => {
            cursor.current = 0
            setLines([])
            setSkipped(0)
          }}
        />
      )}
      {chat.dialog}
    </div>
  )
}
