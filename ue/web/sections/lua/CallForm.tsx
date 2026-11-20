import { FileText, Play } from 'lucide-react'
import { useState } from 'react'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { luaText } from '../../Lua.tsx'
import { Badge, Note } from '../../ui.tsx'
import { parseArg, type CallRes, type LuaFn, type LuaRoot } from './inspect-data.ts'
import { worldName } from './objects-tree/parts.tsx'
import { baseName, type BoundObj } from './objects-tree/tree-model.ts'

/** 在模块表 / 类对象上调带 self 的函数时，可以挑的实例（Inspector 按 selfCandidates 算好传下来） */
export interface SelfChoice {
  why: 'module' | 'class'
  cands: BoundObj[]
}

/**
 * 函数的调用表单（紧凑一行一个参数）：
 * - self 不用勾：看的是实例就传它自己；看的是模块表或类对象时默认挑一个绑这个模块 / 这个类的实例（类不能当实例传给 UE 函数，
 *   用户报过「需要 UserWidget，拿到的是 WidgetBlueprintGeneratedClass」），也可以选「这张表」或「不传」
 * - 返回值按类型列；报错先给一句人话和出错的行，原文收在下面
 */
export function CallForm({
  root,
  fn,
  choice,
  onChanged,
  onOpen,
}: {
  root: LuaRoot
  fn: LuaFn
  choice?: SelfChoice
  onChanged: () => void
  onOpen?: (file: string, line?: number) => void
}) {
  const { project, target } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const hasSelf = fn.params[0] === 'self'
  // UE 导出的 C 函数没有参数名（params 空、vararg），在实例上调时第一个参数也是 self
  const wantsSelf = hasSelf || (!fn.src && fn.vararg)
  const first = choice?.cands[0]?.path
  const [who, setWho] = useState<string>(wantsSelf ? (first ?? 'this') : root.path ? 'this' : 'none')
  const params = hasSelf && who !== 'none' ? fn.params.slice(1) : fn.params
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
        // 选了别的实例：按那个对象的实例表找同名函数（元表链上找到的就是同一个）
        const on = who !== 'this' && who !== 'none' ? { path: who, keys: [fn.name] } : { path: root.path, keys: [...root.keys, fn.name] }
        const r = await op<CallRes>(project.id, 'lua.call', { ...on, self: who !== 'none', args: list }, target, 20000)
        setRes(r)
        onChanged()
      } catch (e) {
        setRes(undefined)
        setError((e as Error).message)
      }
    })

  const thisLabel = root.path
    ? choice?.why === 'class'
      ? t('这个类对象（不是实例）')
      : t('这个对象')
    : t('这张表')
  const selfOptions = [
    ...(choice?.cands ?? []).map((o) => ({
      value: o.path,
      label: o.world ? `${o.name} · ${worldName(o.world)}` : o.name,
    })),
    { value: 'this', label: thisLabel },
    { value: 'none', label: t('不传 self') },
  ]
  const field = 'ue:grid ue:grid-cols-[7rem_minmax(0,1fr)] ue:items-center ue:gap-x-2'

  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5 ue:bg-panel ue:px-4 ue:py-2.5 ue:pl-10">
      <div className={field}>
        <span className="ue:font-mono ue:text-footnote ue:text-muted">self</span>
        <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-2">
          <ui.Select
            size="sm"
            className="ue:w-72 ue:max-w-full"
            value={who}
            onChange={(e: { target: { value: string } }) => setWho(e.target.value)}
            options={selfOptions}
          />
          {choice && !choice.cands.length && who !== 'none' && (
            <span className="ue:truncate ue:text-caption ue:text-warning">
              {choice.why === 'class'
                ? t('这个类现在没有运行中的实例：开始玩之后才有')
                : t('现在没有绑这个模块的对象，self 只能传模块表')}
            </span>
          )}
        </div>
      </div>
      {params.map((p) => (
        <div key={p} className={field}>
          <span className="ue:truncate ue:font-mono ue:text-footnote ue:text-fg">{p}</span>
          <ui.Input
            size="sm"
            className="ue:font-mono"
            placeholder={t('JSON 或字面量，空为 nil')}
            value={args[p] ?? ''}
            onChange={(e: { target: { value: string } }) => setArgs({ ...args, [p]: e.target.value })}
            onKeyDown={(e: { key: string }) => e.key === 'Enter' && call()}
          />
        </div>
      ))}
      {fn.vararg && (
        <div className={field}>
          <span className="ue:font-mono ue:text-footnote ue:text-fg">{params.length ? '...' : t('参数')}</span>
          <ui.Input
            size="sm"
            className="ue:font-mono"
            placeholder={fn.src ? t('其余参数，JSON 数组') : t('UE 函数没有参数名：按顺序写成 JSON 数组，例如 [0, "a"]')}
            value={rest}
            onChange={(e: { target: { value: string } }) => setRest(e.target.value)}
            onKeyDown={(e: { key: string }) => e.key === 'Enter' && call()}
          />
        </div>
      )}
      <div className="ue:flex ue:items-center ue:gap-2 ue:pt-0.5">
        <ui.Button size="sm" disabled={busy === 'call'} onClick={call}>
          <Play className="ue:h-3.5 ue:w-3.5" /> {t('调用')}
        </ui.Button>
        {res && <span className="ue:text-caption ue:text-subtle">{t('{ms} 毫秒', { ms: res.ms.toFixed(1) })}</span>}
      </div>
      {error && <CallError message={error} onOpen={onOpen} />}
      {res && <CallResult res={res} />}
    </div>
  )
}

function CallResult({ res }: { res: CallRes }) {
  return (
    <div className="ue:flex ue:flex-col ue:overflow-hidden ue:rounded-md ue:border ue:border-line ue:bg-card ue:font-mono ue:text-footnote">
      {res.results.length ? (
        res.results.map((r, i) => (
          <div key={i} className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line/60 ue:px-3 ue:py-1 ue:last:border-b-0">
            <span className="ue:w-5 ue:shrink-0 ue:text-subtle">{res.results.length > 1 ? i + 1 : '←'}</span>
            <Badge>{r.t}</Badge>
            <span className="ue:min-w-0 ue:break-all ue:text-fg">{luaText(r)}</span>
          </div>
        ))
      ) : (
        <span className="ue:px-3 ue:py-1 ue:font-sans ue:text-caption ue:text-subtle">{t('没有返回值')}</span>
      )}
      {!!res.output.length && (
        <div className="ue:flex ue:flex-col ue:border-t ue:border-line ue:bg-panel ue:px-3 ue:py-1">
          <span className="ue:font-sans ue:text-caption ue:text-subtle">{t('输出')}</span>
          {res.output.map((l, i) => (
            <span key={i} className="ue:break-all ue:text-muted">
              {l}
            </span>
          ))}
        </div>
      )}
      {!!res.changes?.length && (
        <div className="ue:flex ue:flex-col ue:border-t ue:border-line ue:px-3 ue:py-1">
          <span className="ue:font-sans ue:text-caption ue:text-subtle">{t('self 上变了的字段')}</span>
          {res.changes.map((c) => (
            <span key={c.k} className="ue:text-fg">
              {c.k}: <span className="ue:text-muted">{JSON.stringify(c.before)}</span> → {JSON.stringify(c.after)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const what = (k: string) =>
  ({ field: t('字段'), global: t('全局变量'), local: t('局部变量'), method: t('方法'), constant: t('常量') })[k] ?? k

/** Lua 报错原文 → 一句人话 + 出错的文件和行；认不出的只给原文 */
export function explainLuaError(msg: string): { text?: string; file?: string; line?: number; raw: string } {
  const raw = msg.trim()
  const at = /\[string "(.+?)"\]:(\d+):/.exec(raw) ?? /@?([^\s"'[\]]+\.lua):(\d+):/.exec(raw)
  const loc = at ? { file: at[1], line: Number(at[2]) } : {}
  const self = /UFunction '([^']+)' on invalid self type\. '([^']+)' required but got '([^']+)'/.exec(raw)
  if (self)
    return {
      ...loc,
      raw,
      text: t('self 不对：{fn} 要一个 {need}，传进去的是 {got}。在上面 self 里选一个实例再调', {
        fn: self[1],
        need: self[2],
        got: self[3],
      }),
    }
  const nil = /attempt to (index|call) a nil value \((\w+) '([^']+)'\)/.exec(raw)
  if (nil) {
    const w = what(nil[2])
    let text =
      nil[1] === 'index'
        ? t('{what} {name} 是 nil，不能再取它下面的东西', { what: w, name: nil[3] })
        : t('{what} {name} 是 nil，不能调用', { what: w, name: nil[3] })
    if (nil[3] === 'Super')
      text += t('。UnLua 模块的 Super 一般要写成 UnLua.Class("父模块") 才有；也可能 self 传的不是绑定的实例')
    return { ...loc, raw, text }
  }
  return { ...loc, raw }
}

function CallError({ message, onOpen }: { message: string; onOpen?: (file: string, line?: number) => void }) {
  const { ui } = h()
  const e = explainLuaError(message)
  const [head, trace] = e.raw.split(/\s*stack traceback:\s*/)
  return (
    <Note>
      <div className="ue:flex ue:flex-col ue:gap-1">
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
          <span className="ue:text-fg">{e.text ?? head}</span>
          {e.file && e.line !== undefined && onOpen && (
            <ui.Button size="sm" variant="ghost" onClick={() => onOpen(e.file!, e.line)}>
              <FileText className="ue:h-3.5 ue:w-3.5" /> {t('打开 {file}:{line}', { file: baseName(e.file), line: e.line })}
            </ui.Button>
          )}
        </div>
        {(e.text || trace) && (
          <details className="ue:text-caption ue:text-muted">
            <summary className="ue:cursor-pointer ue:select-none">{t('报错原文')}</summary>
            <pre className="ue:mt-1 ue:whitespace-pre-wrap ue:break-all ue:font-mono">{e.raw}</pre>
          </details>
        )}
      </div>
    </Note>
  )
}
