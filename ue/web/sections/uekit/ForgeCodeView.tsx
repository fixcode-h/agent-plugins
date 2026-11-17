import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { h } from '../../host.ts'

/**
 * 带行号、JSON 着色的只读代码块（「配置原文」页签用）。
 * 大配置（示例界面 WBP_ForgeSample 约 4300 行、28 万字）一次画全部行会生成几万个 span，切页签、滚动都卡，
 * 所以超过 FULL 行就只画看得见的那几十行（行高固定、不换行，按滚动位置算区间），上下用空白撑出滚动条。
 * 不到 FULL 行照旧全画：浏览器的 Ctrl+F 能搜到每一行。每行的着色按行缓存，父组件重渲染不再重算。
 */
const FULL = 800
const OVERSCAN = 30

export function ForgeCodeView({ text, badLine }: { text: string; badLine?: number }) {
  const { cn } = h()
  const lines = useMemo(() => text.split(/\r?\n/), [text])
  // 横向滚动宽度：只画一部分行时容器量不出最长行，按字符估（中日韩全角算两格）
  const maxCh = useMemo(() => lines.reduce((m, l) => Math.max(m, cols(l)), 1), [lines])
  const gutterCh = String(lines.length).length
  const virtual = lines.length > FULL
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
  // 解析失败标红的那行不在第一屏时滚过去，省得用户自己找
  useEffect(() => {
    const el = box.current
    if (!el || !badLine) return
    const y = (badLine - 1) * row
    if (y > el.clientHeight - row * 2) el.scrollTop = y - el.clientHeight / 3
  }, [badLine, row, text])

  const start = virtual ? Math.max(0, Math.floor(view.top / row) - OVERSCAN) : 0
  const end = virtual ? Math.min(lines.length, Math.ceil((view.top + view.height) / row) + OVERSCAN) : lines.length
  const rows: ReactNode[] = []
  for (let i = start; i < end; i++)
    rows.push(<Line key={i} n={i + 1} text={lines[i]} gutterCh={gutterCh} bad={badLine === i + 1} />)

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
        {virtual && <div style={{ height: (lines.length - end) * row }} />}
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
}: {
  n: number
  text: string
  gutterCh: number
  bad: boolean
}) {
  const { cn } = h()
  return (
    <div className={cn('ue:flex ue:whitespace-pre', bad && 'ue:bg-danger/10')}>
      <span
        className="ue:shrink-0 ue:pr-3 ue:pl-3 ue:text-right ue:text-subtle ue:select-none"
        style={{ width: `${gutterCh}ch`, boxSizing: 'content-box' }}
      >
        {n}
      </span>
      <span className="ue:pr-4 ue:text-fg">{paint(text)}</span>
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
