import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { h, t } from '../../host.ts'

/**
 * 带行号、JSON 着色的只读代码块（「配置原文」页签用）。
 * 大配置（示例界面 WBP_ForgeSample 约 4300 行、28 万字）一次画全部行会生成几万个 span，切页签、滚动都卡，
 * 所以超过 FULL 行就只画看得见的那几十行（行高固定、不换行，按滚动位置算区间），上下用空白撑出滚动条。
 * 不到 FULL 行照旧全画：浏览器的 Ctrl+F 能搜到每一行。每行的着色按行缓存，父组件重渲染不再重算。
 * 按段折叠（设计稿 4.3.3）：folds 里的行区间只画第一行，后面跟一个「已折叠 N 行」，点开回调 onUnfold；
 * focusLine（段导航、标记视图点过来的行）滚到视口上三分之一处并标底色，nonce 变了即使同一行也重新滚。
 */
export interface CodeFold {
  start: number
  end: number
}
const FULL = 800
const OVERSCAN = 30

export function ForgeCodeView({
  text,
  badLine,
  folds,
  onUnfold,
  focus,
}: {
  text: string
  badLine?: number
  folds?: CodeFold[]
  onUnfold?: (start: number) => void
  focus?: { line: number; nonce: number }
}) {
  const { cn } = h()
  const lines = useMemo(() => text.split(/\r?\n/), [text])
  // 实际要画的行（从 0 数的下标）：折叠的区间只留第一行；fold 记下被折掉的行数
  const rowsAll = useMemo(() => {
    const out: { i: number; fold?: number }[] = []
    const byStart = new Map((folds ?? []).map((f) => [f.start, f]))
    for (let i = 0; i < lines.length; i++) {
      const f = byStart.get(i + 1)
      if (f && f.end > f.start) {
        out.push({ i, fold: f.end - f.start })
        i = f.end - 1
      } else out.push({ i })
    }
    return out
  }, [lines, folds])
  // 横向滚动宽度：只画一部分行时容器量不出最长行，按字符估（中日韩全角算两格）
  const maxCh = useMemo(() => lines.reduce((m, l) => Math.max(m, cols(l)), 1), [lines])
  const gutterCh = String(lines.length).length
  const virtual = rowsAll.length > FULL
  const box = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLDivElement>(null)
  const [row, setRow] = useState(20)
  const [view, setView] = useState({ top: 0, height: 800 })

  // 行高按实际字号量一次（text-footnote 和 leading-5 跟着主题和设置走，不写死）
  useLayoutEffect(() => {
    const hgt = probe.current?.getBoundingClientRect().height
    if (hgt && hgt > 0) setRow(hgt)
  }, [])
  useEffect(() => {
    const el = box.current
    if (!el || !virtual) return
    const sync = () => setView({ top: el.scrollTop, height: el.clientHeight })
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [virtual])
  /** 某一行（从 1 数）画在第几行：在折叠区间里的算折叠的那一行 */
  const rowOf = (line: number) => {
    let r = 0
    for (let k = 0; k < rowsAll.length; k++) if (rowsAll[k].i + 1 <= line) r = k
    return r
  }
  // 解析失败标红的那行不在第一屏时滚过去，省得用户自己找
  useEffect(() => {
    const el = box.current
    if (!el || !badLine) return
    const y = rowOf(badLine) * row
    if (y > el.clientHeight - row * 2) el.scrollTop = y - el.clientHeight / 3
    // rowOf 跟着 rowsAll 变，依赖列 rowsAll 就够
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [badLine, row, rowsAll])
  // 段导航、标记视图点过来的行：总是滚过去
  useEffect(() => {
    const el = box.current
    if (!el || !focus) return
    el.scrollTop = Math.max(0, rowOf(focus.line) * row - el.clientHeight / 3)
    // 只在点了新的位置时滚（nonce 变），折叠变化不抢滚动，所以不列 rowsAll
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce, focus?.line, row])

  const start = virtual ? Math.max(0, Math.floor(view.top / row) - OVERSCAN) : 0
  const end = virtual ? Math.min(rowsAll.length, Math.ceil((view.top + view.height) / row) + OVERSCAN) : rowsAll.length
  const rows: ReactNode[] = []
  for (let k = start; k < end; k++) {
    const { i, fold } = rowsAll[k]
    rows.push(
      <Line
        key={i}
        n={i + 1}
        text={lines[i]}
        gutterCh={gutterCh}
        bad={badLine === i + 1}
        hit={focus?.line === i + 1}
        fold={fold}
        onUnfold={onUnfold}
      />,
    )
  }

  return (
    <div
      ref={box}
      onScroll={
        virtual ? (e) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight }) : undefined
      }
      className={cn(
        'ue:min-h-0 ue:overflow-auto ue:rounded-lg ue:border ue:border-line ue:bg-sel/25 ue:font-mono ue:text-footnote ue:leading-5',
        virtual && 'ue:flex-1',
      )}
    >
      <div className="ue:relative ue:py-2" style={{ minWidth: `calc(${gutterCh + maxCh}ch + 2.5rem)` }}>
        <div ref={probe} aria-hidden className="ue:invisible ue:absolute">
          0
        </div>
        {virtual && <div style={{ height: start * row }} />}
        {rows}
        {virtual && <div style={{ height: (rowsAll.length - end) * row }} />}
      </div>
    </div>
  )
}

/** 一行：行号 + 着色后的代码；memo 住，滚动时只有新进视口的行要画 */
const Line = memo(function Line({
  n,
  text,
  gutterCh,
  bad,
  hit,
  fold,
  onUnfold,
}: {
  n: number
  text: string
  gutterCh: number
  bad: boolean
  hit?: boolean
  /** 这一行后面折掉了几行 */
  fold?: number
  onUnfold?: (start: number) => void
}) {
  const { cn } = h()
  return (
    <div className={cn('ue:flex ue:whitespace-pre', bad ? 'ue:bg-danger/10' : hit && 'ue:bg-accent/12')}>
      <span
        className="ue:shrink-0 ue:pr-3 ue:pl-3 ue:text-right ue:text-subtle ue:select-none"
        style={{ width: `${gutterCh}ch`, boxSizing: 'content-box' }}
      >
        {n}
      </span>
      <span className="ue:pr-4 ue:text-fg">
        {paint(text)}
        {!!fold && (
          <button
            type="button"
            onClick={() => onUnfold?.(n)}
            className="ue:ml-2 ue:cursor-pointer ue:rounded ue:bg-sel ue:px-1.5 ue:font-sans ue:text-caption ue:text-muted ue:hover:text-fg"
          >
            {t('⋯ 已折叠 {n} 行', { n: fold })}
          </button>
        )}
      </span>
    </div>
  )
})

/** 一行在等宽字体里占几格：全角（中日韩、全角标点）算两格 */
function cols(line: string) {
  let n = 0
  for (const ch of line)
    n += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch)
      ? 2
      : 1
  return n
}

// 字符串（后面跟冒号的是 key）、数字、true / false / null
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g

/** 一行 JSON 着色：key 用 accent，字符串 success，数字 warning，布尔和 null 用 run */
function paint(line: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of line.matchAll(TOKEN)) {
    const at = m.index ?? 0
    if (at > last) out.push(line.slice(last, at))
    const [all, str, colon, num, lit] = m
    if (str !== undefined)
      out.push(
        <span key={at} className={colon ? 'ue:text-accent-text' : 'ue:text-success'}>
          {str}
        </span>,
        colon ?? '',
      )
    else if (num !== undefined)
      out.push(
        <span key={at} className="ue:text-warning">
          {num}
        </span>,
      )
    else if (lit !== undefined)
      out.push(
        <span key={at} className="ue:text-run">
          {lit}
        </span>,
      )
    last = at + all.length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}
