import { AtSign, CircleAlert, DollarSign, FunctionSquare, Lightbulb, Plug } from 'lucide-react'
import { show } from '../../../api.ts'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  EXPR_FUNCTIONS,
  VALUE_SOURCES,
  exprFunction,
  parseExpr,
  refsOf,
  scriptNames,
  wordAt,
  type ExprError,
} from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { useExprNow } from '../gt-live/use-cond-now.ts'
import { sigOf } from '../gt-api/model.ts'
import { exprErrorText, sourceDoc } from './expr-docs.ts'

/** 补全的一项 */
interface Item {
  key: string
  insert: string
  label: string
  detail?: string
  kind: 'var' | 'src' | 'fn' | 'api'
}

const ICON = { var: DollarSign, src: AtSign, fn: FunctionSquare, api: Plug }
const MAX = 12
/** 超过这么多字提示改写成 Lua 代码节点或函数库函数（定稿第 3 节，2.9.0 起不用项目接口）：表达式里堆逻辑没法调试、没法复用 */
const LONG_EXPR = 200

/**
 * 写出来的问题：语法错（带位置）、忘了加 $ 的名字、参数个数不对、没有这个函数或接口、条件里调了会改状态的接口。
 * 只看得出写法上的问题，取不取得到值看下面「此刻」那一行（连着游戏时一直刷新）
 */
export function exprProblems(
  src: string,
  o: { names: Set<string>; apis: Map<string, { readOnly: boolean }>; readOnly: boolean },
): { at: number; text: string } | undefined {
  const r = parseExpr(src)
  if ('error' in r) return { at: r.error.at, text: exprErrorText(r.error as ExprError) }
  const refs = refsOf(r.ast)
  const bare = refs.bareIds[0]
  if (bare) return { at: bare.at, text: t('「{n}」不是函数也不是变量：变量前面要加 $', { n: bare.name }) }
  for (const c of refs.calls) {
    if (c.onSource) continue
    const fn = exprFunction(c.name)
    if (fn) continue
    const api = o.apis.get(c.name)
    if (!api) return o.apis.size ? { at: c.at, text: t('没有叫 {n} 的函数或接口', { n: c.name }) } : undefined
    if (o.readOnly && !api.readOnly)
      return { at: c.at, text: t('{n} 会改游戏状态，条件和表达式里只能用只读接口', { n: c.name }) }
  }
  const unknown = [...refs.vars].map((v) => v.split(/[.[]/)[0]).find((v) => o.names.size && !o.names.has(v))
  if (unknown)
    return {
      at: src.indexOf(`$${unknown}`),
      text: t('${n} 没有定义：在变量、参数里加上，或先用「设变量」', { n: unknown }),
    }
  return undefined
}

/**
 * 表达式输入框（协议第 3 节、定稿 3.3）：等宽字，写的时候就标出错在哪；光标处按 $ / @ / 名字补全
 * 变量、取值来源、内置函数和接口（接口来自接口库，条件里只列只读的）。上下键挑、回车或 Tab 填入、Esc 收起
 */
export function ExprInput({
  value,
  onChange,
  placeholder,
  readOnly = true,
  autoFocus,
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** 只许只读函数（条件、表达式里）；步骤的参数里也一样只算值，所以默认 true */
  readOnly?: boolean
  autoFocus?: boolean
  className?: string
}) {
  const { ui, cn } = h()
  const ctx = useEditCtx()
  const box = useRef<HTMLDivElement>(null)
  const [caret, setCaret] = useState(value.length)
  const [open, setOpen] = useState(false)
  const [act, setAct] = useState(0)

  const names = useMemo(() => (ctx.doc ? scriptNames(ctx.doc) : []), [ctx.doc])
  const apiMap = useMemo(() => new Map(ctx.apis.map((a) => [a.name, a])), [ctx.apis])
  const problem = value.trim()
    ? exprProblems(value, { names: new Set(names.map((n) => n.name)), apis: apiMap, readOnly })
    : undefined
  // 写对了才问游戏：此刻的值（定稿 3.3），连着游戏时一直刷新；GameTest 太旧时不显示
  const now = useExprNow(value.trim() && !problem ? [{ id: 'e', expr: value.trim() }] : undefined)
  const res = now.mode === 'live' ? now.byId.get('e') : undefined

  const word = open ? wordAt(value, caret) : undefined
  const items = useMemo((): Item[] => {
    if (!word) return []
    const w = word.word
    const low = w.toLowerCase()
    if (w.startsWith('$'))
      return names
        .filter((n) => `$${n.name}`.toLowerCase().startsWith(low))
        .map((n) => ({ key: `v:${n.name}`, insert: `$${n.name}`, label: `$${n.name}`, detail: n.from, kind: 'var' }))
    if (w.startsWith('@'))
      return VALUE_SOURCES.filter((s) => `@${s}`.toLowerCase().startsWith(low)).map((s) => ({
        key: `s:${s}`,
        insert: `@${s}`,
        label: `@${s}`,
        detail: sourceDoc(s),
        kind: 'src',
      }))
    const fns: Item[] = EXPR_FUNCTIONS.filter((f) => f.name.toLowerCase().startsWith(low)).map((f) => ({
      key: `f:${f.name}`,
      insert: `${f.name}(`,
      label: `${f.name}(${f.sig})`,
      kind: 'fn',
    }))
    const apis: Item[] = ctx.apis
      .filter((a) => (!readOnly || a.readOnly) && a.name.toLowerCase().includes(low))
      .map((a) => ({
        key: `a:${a.name}`,
        insert: `${a.name}(`,
        label: sigOf(a),
        detail: a.display ?? a.category,
        kind: 'api',
      }))
    return [...fns, ...apis]
  }, [word, names, ctx.apis, readOnly])
  const shown = items.slice(0, MAX)

  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', off)
    return () => document.removeEventListener('pointerdown', off)
  }, [open])

  const pick = (it: Item) => {
    if (!word) return
    const next = value.slice(0, word.from) + it.insert + value.slice(caret)
    onChange(next)
    const pos = word.from + it.insert.length
    setCaret(pos)
    setOpen(false)
    requestAnimationFrame(() => box.current?.querySelector('input')?.setSelectionRange(pos, pos))
  }

  return (
    <div ref={box} className={cn('ue:relative ue:flex ue:flex-col ue:gap-1', className)}>
      <ui.Input
        size="sm"
        autoFocus={autoFocus}
        spellCheck={false}
        className={cn('ue:w-full ue:font-mono', problem && 'ue:border-danger/70')}
        placeholder={placeholder ?? t('例如 @ps.Gold >= $gold0 + 500')}
        value={value}
        aria-invalid={!!problem}
        onFocus={() => setOpen(true)}
        onSelect={(e: { currentTarget: HTMLInputElement }) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onChange={(e: { target: HTMLInputElement }) => {
          onChange(e.target.value)
          setCaret(e.target.selectionStart ?? e.target.value.length)
          setOpen(true)
          setAct(0)
        }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (!open || !shown.length) return
          if (e.key === 'ArrowDown') setAct((a) => Math.min(a + 1, shown.length - 1))
          else if (e.key === 'ArrowUp') setAct((a) => Math.max(a - 1, 0))
          else if ((e.key === 'Enter' || e.key === 'Tab') && shown[act]) pick(shown[act])
          else if (e.key === 'Escape') {
            setOpen(false)
            e.stopPropagation()
          } else return
          e.preventDefault()
        }}
      />
      {problem && (
        <span className="ue:flex ue:items-start ue:gap-1 ue:text-caption ue:text-danger">
          <CircleAlert className="ue:mt-px ue:h-3 ue:w-3 ue:shrink-0" />
          <span>
            {t('第 {n} 个字：', { n: problem.at + 1 })}
            {problem.text}
          </span>
        </span>
      )}
      {!problem && value.trim().length > LONG_EXPR && (
        <span className="ue:flex ue:items-start ue:gap-1 ue:text-caption ue:text-warning">
          <Lightbulb className="ue:mt-px ue:h-3 ue:w-3 ue:shrink-0" />
          <span>
            {t('表达式超过 {n} 字：改写成 Lua 代码节点或函数库函数，更好维护和调试', {
              n: LONG_EXPR,
            })}
          </span>
        </span>
      )}
      {res && !problem && (
        <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:text-caption ue:text-subtle">
          <span className="ue:h-1.5 ue:w-1.5 ue:shrink-0 ue:rounded-full ue:bg-success ue:motion-safe:animate-pulse" />
          {res.error || res.unresolved ? (
            <span className="ue:truncate ue:text-warning">
              {res.error ?? t('读不到：{r}', { r: res.unresolved ?? '' })}
            </span>
          ) : (
            <span className="ue:truncate ue:font-mono">
              {t('此刻 = {v}', { v: show(res.value) })}
              {res.type && <span className="ue:ml-1.5 ue:font-sans">{res.type}</span>}
            </span>
          )}
        </span>
      )}
      {open && shown.length > 0 && (
        <div
          role="listbox"
          className="ue:absolute ue:inset-x-0 ue:top-8 ue:z-30 ue:flex ue:max-h-64 ue:flex-col ue:overflow-auto ue:rounded-(--c-menu-radius) ue:border-(length:--c-menu-border) ue:border-pop-edge ue:bg-(--c-menu-bg) ue:p-1 ue:text-footnote ue:shadow-pop ue:motion-safe:animate-pop"
        >
          {shown.map((it, i) => {
            const Icon = ICON[it.kind]
            return (
              <button
                key={it.key}
                type="button"
                role="option"
                aria-selected={i === act}
                onPointerDown={(e) => e.preventDefault()}
                onPointerEnter={() => setAct(i)}
                onClick={() => pick(it)}
                className={cn(
                  'ue:flex ue:h-7 ue:w-full ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-(--c-menu-itemRadius) ue:px-2 ue:text-left',
                  i === act && 'ue:bg-hover',
                )}
              >
                <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
                <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-fg">{it.label}</span>
                {it.detail && (
                  <span className="ue:ml-auto ue:shrink-0 ue:truncate ue:text-caption ue:text-subtle">{it.detail}</span>
                )}
              </button>
            )
          })}
          {items.length > shown.length && (
            <span className="ue:px-2 ue:py-1 ue:text-caption ue:text-subtle">
              {t('还有 {n} 个，多打几个字', { n: items.length - shown.length })}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
