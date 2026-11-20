import { ChevronRight, Eye, Play, SquarePen } from 'lucide-react'
import { useState } from 'react'
import type { LuaKey } from '../../../server/luapath.ts'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { luaText, type LuaField } from '../../Lua.tsx'
import { ErrorText } from '../../ui.tsx'
import { parseArg, signature, type CallRes, type LuaFn, type LuaRoot } from './inspect-data.ts'
import { parseSrc } from './objects-tree/tree-model.ts'

const SCALAR = new Set(['nil', 'boolean', 'number', 'string'])
export const keyOf = (f: LuaField): LuaKey | undefined =>
  f.kt === 'number' ? f.kn : f.kt === 'string' ? f.k : undefined
const keyLabel = (f: LuaField) => (f.kt === 'number' ? `[${f.k}]` : f.k)

/**
 * 检视区的一个字段：表点名字往下走；标量回车改（lua.set，进操作记录可撤回）；表可以整个换成 JSON（换掉的表撤不回，先提示）
 */
export function FieldRow({
  root,
  f,
  onDown,
  onOpenObj,
  onWatch,
  onChanged,
}: {
  root: LuaRoot
  f: LuaField
  onDown: (k: LuaKey) => void
  onOpenObj: (path: string) => void
  onWatch: (k: LuaKey) => void
  onChanged: () => void
}) {
  const { project, target } = useUe()
  const { ui, toast } = h()
  const { busy, run } = useAction()
  const [json, setJson] = useState<string>()
  const k = keyOf(f)
  const set = (value: unknown) =>
    run('set', async () => {
      if (k === undefined) return
      await op(project.id, 'lua.set', { path: root.path, keys: [...root.keys, k], value }, target)
      setJson(undefined)
      onChanged()
    })
  const submit = (raw: string) => {
    // 原来是字符串的按原样存（不用加引号）；其余按 JSON / 字面量解析
    const v = f.t === 'string' ? raw : parseArg(raw)
    if (f.t === 'number' && typeof v !== 'number') return toast.error(t('这里要填数字'))
    void set(v)
  }
  return (
    <div className="ue:group ue:flex ue:items-center ue:gap-3 ue:border-b ue:border-line/60 ue:px-4 ue:py-1.5">
      <div className="ue:flex ue:w-[36%] ue:min-w-0 ue:shrink-0 ue:items-center ue:gap-1.5">
        {f.t === 'table' && k !== undefined ? (
          <button
            type="button"
            onClick={() => onDown(k)}
            className="ue:flex ue:min-w-0 ue:cursor-pointer ue:items-center ue:gap-1 ue:text-left ue:text-fg ue:hover:text-accent-text"
          >
            <ChevronRight className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
            <span className="ue:truncate ue:font-mono ue:text-body">{keyLabel(f)}</span>
          </button>
        ) : (
          <span className="ue:truncate ue:pl-4.5 ue:font-mono ue:text-body ue:text-fg">{keyLabel(f)}</span>
        )}
        <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{f.t}</span>
      </div>
      <div className="ue:min-w-0 ue:flex-1">
        {json !== undefined ? (
          <form
            className="ue:flex ue:gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              try {
                void set(JSON.parse(json))
              } catch {
                toast.error(t('不是合法的 JSON'))
              }
            }}
          >
            <ui.Input
              size="sm"
              autoFocus
              className="ue:flex-1 ue:font-mono"
              value={json}
              onChange={(e: { target: { value: string } }) => setJson(e.target.value)}
            />
            <ui.Button size="sm" type="submit" disabled={!!busy}>
              {t('替换')}
            </ui.Button>
            <ui.Button size="sm" variant="ghost" onClick={() => setJson(undefined)}>
              {t('取消')}
            </ui.Button>
          </form>
        ) : SCALAR.has(f.t) && k !== undefined && !f.len ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit(String(new FormData(e.currentTarget).get('v') ?? ''))
            }}
          >
            <ui.Input
              size="sm"
              name="v"
              key={String(f.v)}
              defaultValue={f.t === 'nil' ? '' : String(f.v ?? '')}
              placeholder={f.t === 'nil' ? 'nil' : undefined}
              disabled={!!busy}
              aria-label={f.k}
              className="ue:font-mono"
            />
          </form>
        ) : f.obj ? (
          <button
            type="button"
            onClick={() => onOpenObj(f.obj!)}
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
      <span className="ue:flex ue:w-14 ue:shrink-0 ue:justify-end ue:gap-0.5 ue:opacity-0 ue:group-hover:opacity-100">
        {f.t === 'table' && k !== undefined && json === undefined && (
          <ui.IconButton
            icon={SquarePen}
            size="xs"
            label={t('整个换成 JSON（换掉的表不能撤回）')}
            onClick={() => setJson('{}')}
          />
        )}
        {k !== undefined && <ui.IconButton icon={Eye} size="xs" label={t('加到监视')} onClick={() => onWatch(k)} />}
      </span>
    </div>
  )
}

/**
 * 函数行：点开是调用表单。第一个参数叫 self 时默认按 obj:fn() 调。
 * 定义位置只写「:行号」（同一层的文件写在分组标题上），点了用编辑器打开到那一行；C 函数（UE 导出）没有位置
 */
export function FnRow({
  root,
  fn,
  onChanged,
  onOpen,
}: {
  root: LuaRoot
  fn: LuaFn
  onChanged: () => void
  onOpen?: (file: string, line?: number) => void
}) {
  const { cn } = h()
  const [open, setOpen] = useState(false)
  const at = fn.src ? parseSrc(fn.src) : undefined
  return (
    <div className="ue:border-b ue:border-line/60">
      <div className="ue:group ue:flex ue:items-center ue:gap-2 ue:px-4 ue:hover:bg-hover">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ue:flex ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:items-center ue:gap-2 ue:py-1.5 ue:text-left"
        >
          <ChevronRight
            className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle ue:transition-transform', open && 'ue:rotate-90')}
          />
          <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-body ue:text-fg">{signature(fn)}</span>
          <span className="ue:flex ue:shrink-0 ue:items-center ue:gap-1 ue:text-caption ue:text-subtle ue:opacity-0 ue:group-hover:opacity-100">
            <Play className="ue:h-3 ue:w-3" /> {t('调用')}
          </span>
        </button>
        {at?.line !== undefined ? (
          <button
            type="button"
            title={`${at.file}:${at.line}`}
            onClick={() => onOpen?.(at.file, at.line)}
            className="ue:shrink-0 ue:cursor-pointer ue:font-mono ue:text-caption ue:text-subtle ue:hover:text-accent-text ue:hover:underline"
          >
            :{at.line}
          </button>
        ) : (
          <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{fn.src ? fn.src : t('C 函数')}</span>
        )}
      </div>
      {open && <CallForm root={root} fn={fn} onChanged={onChanged} />}
    </div>
  )
}

function CallForm({ root, fn, onChanged }: { root: LuaRoot; fn: LuaFn; onChanged: () => void }) {
  const { project, target } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const hasSelf = fn.params[0] === 'self'
  const [self, setSelf] = useState(hasSelf || !root.path)
  const params = self && hasSelf ? fn.params.slice(1) : fn.params
  const [args, setArgs] = useState<Record<string, string>>({})
  const [rest, setRest] = useState('')
  const [res, setRes] = useState<CallRes>()
  const [error, setError] = useState('')
  const call = () =>
    run('call', async () => {
      setError('')
      try {
        const extra = rest.trim() ? parseArg(rest) : []
        const list = [...params.map((p) => parseArg(args[p] ?? '')), ...(Array.isArray(extra) ? extra : [extra])]
        const r = await op<CallRes>(
          project.id,
          'lua.call',
          { path: root.path, keys: [...root.keys, fn.name], self, args: list },
          target,
          20000,
        )
        setRes(r)
        onChanged()
      } catch (e) {
        setRes(undefined)
        setError((e as Error).message)
      }
    })
  return (
    <div className="ue:flex ue:flex-col ue:gap-2 ue:bg-panel ue:px-4 ue:py-3 ue:pl-10">
      <label className="ue:flex ue:w-fit ue:cursor-pointer ue:items-center ue:gap-1.5 ue:text-footnote ue:text-muted">
        <input
          type="checkbox"
          checked={self}
          onChange={(e) => setSelf(e.target.checked)}
          className="ue:accent-accent"
        />
        {t('把这张表当 self 传入（obj:{fn}()）', { fn: fn.name })}
      </label>
      {params.map((p) => (
        <div key={p} className="ue:flex ue:items-center ue:gap-2">
          <span className="ue:w-28 ue:shrink-0 ue:truncate ue:font-mono ue:text-footnote ue:text-fg">{p}</span>
          <ui.Input
            size="sm"
            className="ue:flex-1 ue:font-mono"
            placeholder={t('JSON 或字面量，空为 nil')}
            value={args[p] ?? ''}
            onChange={(e: { target: { value: string } }) => setArgs({ ...args, [p]: e.target.value })}
          />
        </div>
      ))}
      {fn.vararg && (
        <div className="ue:flex ue:items-center ue:gap-2">
          <span className="ue:w-28 ue:shrink-0 ue:font-mono ue:text-footnote ue:text-fg">...</span>
          <ui.Input
            size="sm"
            className="ue:flex-1 ue:font-mono"
            placeholder={t('其余参数，JSON 数组')}
            value={rest}
            onChange={(e: { target: { value: string } }) => setRest(e.target.value)}
          />
        </div>
      )}
      <div className="ue:flex ue:items-center ue:gap-2">
        <ui.Button size="sm" disabled={busy === 'call'} onClick={call}>
          <Play className="ue:h-3.5 ue:w-3.5" /> {t('调用')}
        </ui.Button>
        {res && <span className="ue:text-caption ue:text-subtle">{t('{ms} 毫秒', { ms: res.ms.toFixed(1) })}</span>}
      </div>
      <ErrorText>{error}</ErrorText>
      {res && (
        <div className="ue:flex ue:flex-col ue:gap-1 ue:font-mono ue:text-footnote">
          {res.results.length ? (
            res.results.map((r, i) => (
              <span key={i} className="ue:text-fg">
                ← {luaText(r)}
              </span>
            ))
          ) : (
            <span className="ue:text-subtle">{t('没有返回值')}</span>
          )}
          {res.output.map((l, i) => (
            <span key={`o${i}`} className="ue:text-muted">
              {l}
            </span>
          ))}
          {!!res.changes?.length && (
            <div className="ue:mt-1 ue:flex ue:flex-col">
              <span className="ue:font-sans ue:text-caption ue:text-subtle">{t('self 上变了的字段')}</span>
              {res.changes.map((c) => (
                <span key={c.k} className="ue:text-fg">
                  {c.k}: {JSON.stringify(c.before)} → {JSON.stringify(c.after)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
