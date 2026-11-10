import { ArrowDown, Copy, Eraser, Pause, Play } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { pget, ppost, useAction, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Badge, Card, ErrorText, PageHead, SearchBox, fmtSize, fmtTime, kindLabel } from '../ui.tsx'

interface Line {
  seq: number
  category: string
  verbosity: string
  text: string
}
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

/** 网页里最多留多少行（再多的旧行丢掉）；只画看得见的几十行，日志刷屏也不卡 */
const MAX_LINES = 5000
const ROW = 20

/**
 * 日志（图 9）：在跑的 UE 按游标每秒增量取（筛选在桥接里做，只传匹配的行），没在跑读日志文件；
 * 滚上去看旧行时自动暂停跟随；清空正在写的日志文件（设计文档 3.5）；崩溃记录
 */
export function Logs() {
  const { project } = useUe()
  const { cn, ui, toast } = h()
  const [tab, setTab] = useState<'log' | 'crash'>('log')
  const [filter, setFilter] = useState({ category: '', verbosity: '', contains: '' })
  const [lines, setLines] = useState<Line[]>([])
  const [info, setInfo] = useState<Omit<TailRes, 'lines'>>()
  const [skipped, setSkipped] = useState(0)
  const [error, setError] = useState('')
  const [follow, setFollow] = useState(true)
  const [paused, setPaused] = useState(false)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [clearOpen, setClearOpen] = useState(false)
  const cursor = useRef(0)
  const box = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState({ top: 0, height: 400 })
  const inFlight = useRef(false)

  // 筛选变了：从头取
  useEffect(() => {
    cursor.current = 0
    setLines([])
    setSkipped(0)
    setSel(new Set())
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
        const { lines: got, ...rest } = r
        setInfo(rest)
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

  useLayoutEffect(() => {
    const el = box.current
    if (el && follow) el.scrollTop = el.scrollHeight
  }, [lines, follow])

  const onScroll = () => {
    const el = box.current
    if (!el) return
    setScroll({ top: el.scrollTop, height: el.clientHeight })
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < ROW * 2)
  }
  const first = Math.max(0, Math.floor(scroll.top / ROW) - 10)
  const last = Math.min(lines.length, Math.ceil((scroll.top + scroll.height) / ROW) + 10)

  const copy = () => {
    const text = lines
      .filter((l) => sel.has(l.seq))
      .map((l) => `${l.category}: ${l.verbosity !== 'Log' ? `${l.verbosity}: ` : ''}${l.text}`)
      .join('\n')
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success(t('已复制 {n} 行，可以粘贴到对话里分析', { n: sel.size })))
  }
  const tone = (v: string) =>
    /Error|Fatal/.test(v) ? 'ue:text-danger' : v === 'Warning' ? 'ue:text-warning' : 'ue:text-term-fg'

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead
        title={t('日志')}
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
        <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-3 ue:p-6">
          <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
            <ui.Select
              size="sm"
              className="ue:w-36"
              value={filter.verbosity}
              onChange={(e: { target: { value: string } }) => setFilter((f) => ({ ...f, verbosity: e.target.value }))}
              options={[
                { value: '', label: t('所有级别') },
                { value: 'Error', label: t('只看错误') },
                { value: 'Warning', label: t('警告及以上') },
                { value: 'Display', label: 'Display' },
                { value: 'Log', label: 'Log' },
              ]}
            />
            <div className="ue:w-44">
              <SearchBox
                placeholder={t('分类，例如 LogNet')}
                allowEmpty
                onSearch={(c) => setFilter((f) => ({ ...f, category: c }))}
              />
            </div>
            <div className="ue:min-w-48 ue:flex-1">
              <SearchBox
                placeholder={t('包含的文字')}
                allowEmpty
                onSearch={(c) => setFilter((f) => ({ ...f, contains: c }))}
              />
            </div>
            {info && (
              <span className="ue:text-footnote ue:text-subtle">
                <span className={info.errors ? 'ue:text-danger' : ''}>{t('{n} 错误', { n: info.errors })}</span> ·{' '}
                {t('{n} 警告', { n: info.warnings })}
              </span>
            )}
            <ui.Button size="sm" variant="secondary" onClick={() => setPaused((p) => !p)}>
              {paused ? <Play className="ue:h-3.5 ue:w-3.5" /> : <Pause className="ue:h-3.5 ue:w-3.5" />}{' '}
              {paused ? t('继续') : t('暂停')}
            </ui.Button>
            {sel.size > 0 && (
              <ui.Button size="sm" onClick={copy}>
                <Copy className="ue:h-3.5 ue:w-3.5" /> {t('复制所选 {n} 行', { n: sel.size })}
              </ui.Button>
            )}
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
              className="ue:absolute ue:inset-0 ue:overflow-auto ue:rounded-xl ue:bg-term-bg ue:font-mono ue:text-footnote"
            >
              <div style={{ height: lines.length * ROW, position: 'relative' }}>
                {lines.slice(first, last).map((l, i) => (
                  <div
                    key={l.seq}
                    onClick={(e) =>
                      setSel((s) => {
                        const n = new Set(e.shiftKey || e.metaKey || e.ctrlKey ? s : [])
                        if (s.has(l.seq) && (e.metaKey || e.ctrlKey)) n.delete(l.seq)
                        else n.add(l.seq)
                        return n
                      })
                    }
                    style={{ top: (first + i) * ROW, height: ROW }}
                    className={cn(
                      'ue:absolute ue:inset-x-0 ue:flex ue:cursor-default ue:gap-2 ue:truncate ue:px-4 ue:leading-5',
                      tone(l.verbosity),
                      sel.has(l.seq) && 'ue:bg-term-hover',
                    )}
                    title={l.text.length > 160 ? l.text : undefined}
                  >
                    <span className="ue:shrink-0 ue:text-term-subtle">{l.category}</span>
                    <span className="ue:truncate">{l.text}</span>
                  </div>
                ))}
              </div>
              {!lines.length && (
                <div className="ue:absolute ue:inset-0 ue:flex ue:items-center ue:justify-center ue:text-term-subtle">
                  {t('没有日志')}
                </div>
              )}
            </div>
            {!follow && (
              <button
                type="button"
                onClick={() => setFollow(true)}
                className="ue:absolute ue:right-4 ue:bottom-4 ue:flex ue:h-7 ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded-full ue:bg-card ue:px-3 ue:text-footnote ue:text-fg ue:shadow-pop"
              >
                <ArrowDown className="ue:h-3.5 ue:w-3.5" /> {t('回到最新')}
              </button>
            )}
          </div>
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
    </div>
  )
}

/** 清空弹窗：列出会被清空的进程和日志文件；默认只勾目标所在的进程，可以全选；可选先另存一份 */
function ClearDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
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

function Crashes() {
  const { project } = useUe()
  const list = useLoad(() => pget<{ items: Crash[] }>(project.id, 'crashes'), [project.id])
  return (
    <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:p-6">
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
