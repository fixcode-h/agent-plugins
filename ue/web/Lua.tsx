import { ChevronRight, Copy, FunctionSquare } from 'lucide-react'
import { useState } from 'react'
import { formatLuaPath, type LuaKey } from '../server/luapath.ts'
import { op, useAction, useLoad } from './api.ts'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'
import { Badge, ErrorText, Note } from './ui.tsx'

/** 桥接 lua.get 回的一个值（AgentPanelLua.cpp 的 Describe）：t 类型、v 标量值、n 表的项数、obj 对应的 UObject、src 函数定义位置 */
export interface LuaDesc {
  t: string
  v?: unknown
  int?: boolean
  len?: number
  n?: number
  nMore?: boolean
  obj?: string
  class?: string
  module?: string
  src?: string
}
export interface LuaField extends LuaDesc {
  k: string
  kt: string
  kn?: number
}
interface LuaGet {
  object?: { path: string; name: string; class: string; module: string; bound: boolean }
  value: LuaDesc
  fields?: LuaField[]
  total?: number
  more?: boolean
  truncated?: boolean
  functions?: { name: string; src?: string }[]
  note?: string
}

const PAGE = 200
const SCALAR = new Set(['nil', 'boolean', 'number', 'string'])

const keyOf = (f: LuaField): LuaKey | undefined => (f.kt === 'number' ? f.kn : f.kt === 'string' ? f.k : undefined)

/** 一个值的简短文字（表显示项数，UObject 显示类名，函数显示定义位置） */
export function luaText(d: LuaDesc): string {
  if (d.t === 'nil') return 'nil'
  if (d.t === 'string') return JSON.stringify(d.v) + (d.len ? ` …（${d.len}）` : '')
  if (d.t === 'number' || d.t === 'boolean') return String(d.v)
  if (d.t === 'table')
    return `{ ${t('{n} 项', { n: `${d.n ?? 0}${d.nMore ? '+' : ''}` })} }${d.module ? ` · ${d.module}` : ''}`
  if (d.obj) return `${d.class ?? 'UObject'} · ${d.obj}`
  if (d.t === 'function') return d.src ? `function · ${d.src}` : 'function（C）'
  return d.t
}

/** 文本框里的字转成 Lua 值：按原来的类型转；原来是 nil 时按字面猜（nil、true / false、数字，其余当字符串） */
function parseInput(raw: string, was: string): unknown {
  const s = raw.trim()
  if (s === 'nil') return null
  if (was === 'number') {
    if (s === '' || isNaN(Number(s))) throw new Error(t('这里要填数字'))
    return Number(s)
  }
  if (was === 'string') return raw
  if (s === 'true' || s === 'false') return s === 'true'
  if (s !== '' && !isNaN(Number(s))) return Number(s)
  return /^(["']).*\1$/.test(s) ? s.slice(1, -1) : raw
}

/**
 * Lua 表浏览（属性面板的「Lua」页签、Lua 页的全局表）：一次列一层，点表往下走，顶上是路径可以点回去；
 * 数字、字符串、布尔、nil 可以直接改（进操作记录，可撤回）；对象可点开；实例表下面列模块里的函数。
 * path 为空时从全局表 _G 开始
 */
export function LuaTable({
  path,
  initial = [],
  onOpen,
}: {
  path: string
  initial?: LuaKey[]
  onOpen?: (path: string) => void
}) {
  const { project, target } = useUe()
  const { ui, cn, toast } = h()
  const [keys, setKeys] = useState<LuaKey[]>(initial)
  const [extra, setExtra] = useState<LuaField[]>([])
  const [fnOpen, setFnOpen] = useState(false)
  const { busy, run } = useAction()
  const data = useLoad(() => {
    setExtra([])
    return op<LuaGet>(project.id, 'lua.get', { path, keys, offset: 0, limit: PAGE }, target)
  }, [path, keys.join('\u0001'), target.instance, target.world])
  const fields = [...(data.data?.fields ?? []), ...extra]
  const more = extra.length ? fields.length < Math.min(data.data?.total ?? 0, 5000) : data.data?.more
  const root = path ? t('实例表') : '_G'
  const full = formatLuaPath(keys)

  const loadMore = () =>
    run('more', async () => {
      const r = await op<LuaGet>(project.id, 'lua.get', { path, keys, offset: fields.length, limit: PAGE }, target)
      setExtra((x) => [...x, ...(r.fields ?? [])])
    })

  const set = (f: LuaField, value: unknown) =>
    run(`set${f.k}`, async () => {
      const k = keyOf(f)
      if (k === undefined) return
      await op(project.id, 'lua.set', { path, keys: [...keys, k], value }, target)
      void data.reload()
    })

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1 ue:border-b ue:border-line ue:px-4 ue:py-2 ue:font-mono ue:text-footnote">
        {[root, ...keys].map((k, i) => (
          <span key={i} className="ue:flex ue:items-center ue:gap-1">
            {i > 0 && <ChevronRight className="ue:h-3 ue:w-3 ue:text-subtle" />}
            <button
              type="button"
              disabled={i === keys.length}
              onClick={() => setKeys(keys.slice(0, i))}
              className={cn(
                'ue:rounded-sm ue:px-1',
                i === keys.length ? 'ue:text-fg' : 'ue:cursor-pointer ue:text-accent-text ue:hover:underline',
              )}
            >
              {typeof k === 'number' ? `[${k}]` : k}
            </button>
          </span>
        ))}
        {data.data?.object?.module && <Badge tone="accent">{data.data.object.module}</Badge>}
        <span className="ue:ml-auto ue:text-caption ue:text-subtle">
          {data.data?.total !== undefined && t('{n} 项', { n: data.data.total })}
        </span>
        {full && (
          <ui.IconButton
            icon={Copy}
            label={t('复制 Lua 路径')}
            size="xs"
            onClick={() => void navigator.clipboard.writeText(full).then(() => toast.success(t('已复制')))}
          />
        )}
      </div>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:py-1">
        <div className="ue:px-4">
          <ErrorText>{data.error}</ErrorText>
        </div>
        {data.data?.note && (
          <div className="ue:px-4 ue:py-2">
            <Note tone="info">{data.data.note}</Note>
          </div>
        )}
        {data.loading && !data.data && <p className="ue:px-4 ue:text-footnote ue:text-subtle">{t('读取中…')}</p>}
        {data.data && data.data.value.t !== 'table' && !data.data.note && (
          <div className="ue:px-4 ue:py-2 ue:font-mono ue:text-footnote ue:text-fg">{luaText(data.data.value)}</div>
        )}
        {fields.map((f, i) => {
          const k = keyOf(f)
          return (
            <div
              key={`${f.k}\u0001${i}`}
              className="ue:flex ue:items-center ue:gap-3 ue:border-b ue:border-line/60 ue:px-4 ue:py-1.5"
            >
              <div className="ue:flex ue:w-[38%] ue:min-w-0 ue:shrink-0 ue:items-center ue:gap-1.5">
                {f.t === 'table' && k !== undefined ? (
                  <button
                    type="button"
                    onClick={() => setKeys([...keys, k])}
                    className="ue:flex ue:min-w-0 ue:cursor-pointer ue:items-center ue:gap-1 ue:text-left ue:text-fg ue:hover:text-accent-text"
                  >
                    <ChevronRight className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
                    <span className="ue:truncate ue:font-mono ue:text-body">
                      {f.kt === 'number' ? `[${f.k}]` : f.k}
                    </span>
                  </button>
                ) : (
                  <>
                    <span className="ue:w-3.5 ue:shrink-0" />
                    <span className="ue:truncate ue:font-mono ue:text-body ue:text-fg">
                      {f.kt === 'number' ? `[${f.k}]` : f.k}
                    </span>
                  </>
                )}
                <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{f.t}</span>
              </div>
              <div className="ue:min-w-0 ue:flex-1">
                {SCALAR.has(f.t) && k !== undefined ? (
                  <LuaEdit
                    f={f}
                    busy={busy === `set${f.k}`}
                    onSet={(raw) => {
                      try {
                        void set(f, typeof raw === 'boolean' ? raw : parseInput(raw, f.t))
                      } catch (e) {
                        toast.error((e as Error).message)
                      }
                    }}
                  />
                ) : f.obj && onOpen ? (
                  <button
                    type="button"
                    onClick={() => onOpen(f.obj!)}
                    title={f.obj}
                    className="ue:max-w-full ue:cursor-pointer ue:truncate ue:font-mono ue:text-footnote ue:text-accent-text ue:hover:underline"
                  >
                    {luaText(f)}
                  </button>
                ) : (
                  <span className="ue:block ue:truncate ue:font-mono ue:text-footnote ue:text-muted" title={luaText(f)}>
                    {luaText(f)}
                  </span>
                )}
              </div>
            </div>
          )
        })}
        {data.data && data.data.value.t === 'table' && !fields.length && (
          <p className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">{t('空表')}</p>
        )}
        {more && (
          <div className="ue:px-4 ue:py-2">
            <ui.Button size="sm" variant="secondary" disabled={busy === 'more'} onClick={() => void loadMore()}>
              {t('再列 {n} 项', { n: PAGE })}
            </ui.Button>
          </div>
        )}
        {data.data?.truncated && !more && (
          <p className="ue:px-4 ue:py-2 ue:text-caption ue:text-subtle">
            {t('表太大，只按顺序列了前 5000 项；具体字段用 Lua 路径直接取')}
          </p>
        )}
        {!!data.data?.functions?.length && (
          <section className="ue:mt-2">
            <button
              type="button"
              onClick={() => setFnOpen((v) => !v)}
              className="ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-1.5 ue:bg-hover/60 ue:px-4 ue:py-1.5 ue:text-footnote ue:font-medium ue:text-muted"
            >
              <ChevronRight className={cn('ue:h-3.5 ue:w-3.5 ue:transition-transform', fnOpen && 'ue:rotate-90')} />
              <FunctionSquare className="ue:h-3.5 ue:w-3.5" />
              {t('模块函数（{n}）', { n: data.data.functions.length })}
            </button>
            {fnOpen &&
              data.data.functions.map((fn) => (
                <div
                  key={fn.name}
                  className="ue:flex ue:items-center ue:gap-3 ue:border-b ue:border-line/60 ue:px-4 ue:py-1.5"
                >
                  <span className="ue:font-mono ue:text-footnote ue:text-fg">{fn.name}</span>
                  <span className="ue:ml-auto ue:truncate ue:font-mono ue:text-caption ue:text-subtle">
                    {fn.src ?? t('C 函数')}
                  </span>
                </div>
              ))}
          </section>
        )}
      </div>
    </div>
  )
}

/** 标量字段的编辑：布尔是开关，其余文本框回车提交（失焦不提交，免得误改） */
function LuaEdit({ f, busy, onSet }: { f: LuaField; busy: boolean; onSet: (v: string | boolean) => void }) {
  const { cn } = h()
  if (f.t === 'boolean')
    return (
      <button
        type="button"
        role="switch"
        aria-checked={f.v === true}
        aria-label={f.k}
        disabled={busy}
        onClick={() => onSet(!(f.v === true))}
        className={cn(
          'ue:relative ue:h-5 ue:w-9 ue:cursor-pointer ue:rounded-full ue:transition-colors',
          f.v === true ? 'ue:bg-accent' : 'ue:bg-line-strong',
        )}
      >
        <span
          className={cn(
            'ue:absolute ue:top-0.5 ue:h-4 ue:w-4 ue:rounded-full ue:bg-card ue:shadow-card ue:transition-all',
            f.v === true ? 'ue:left-4.5' : 'ue:left-0.5',
          )}
        />
      </button>
    )
  const v = f.t === 'nil' ? '' : String(f.v ?? '')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSet(String(new FormData(e.currentTarget).get('v') ?? ''))
      }}
      className="ue:flex ue:h-7 ue:items-center ue:rounded-md ue:border ue:border-line ue:bg-field ue:px-2 ue:focus-within:border-focus"
    >
      <input
        name="v"
        key={v}
        defaultValue={v}
        placeholder={f.t === 'nil' ? 'nil' : undefined}
        disabled={busy || !!f.len}
        aria-label={f.k}
        className="ue:min-w-0 ue:flex-1 ue:bg-transparent ue:font-mono ue:text-footnote ue:text-fg ue:outline-none ue:placeholder:text-subtle"
      />
    </form>
  )
}
