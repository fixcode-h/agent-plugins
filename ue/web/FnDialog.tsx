import { CheckCircle2, Play, XCircle } from 'lucide-react'
import { useState } from 'react'
import { op, useAction } from './api.ts'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'
import { ObjectArg } from './ObjectArg.tsx'
import { Badge, Term } from './ui.tsx'

export interface FnParam {
  name: string
  type: string
  out?: boolean
  enum?: string[]
  /** 对象参数能赋的类（桥接 1.9.0 起） */
  objectClass?: string
  objectClassPath?: string
}
export interface Fn {
  name: string
  owner: string
  category: string
  tooltip: string
  params: FnParam[]
  ret: string
  /** public / protected / private；旧桥接没有，当公有 */
  access?: 'public' | 'protected' | 'private'
  /** 蓝图可调（BlueprintCallable、Exec、标了 AgentPanel）；旧桥接只列这些，没有这个字段 */
  blueprint?: boolean
}
export interface FnResult {
  ok: boolean
  ret?: unknown
  out?: Record<string, unknown>
  error?: string
  ms?: number
}

const fmt = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))

/**
 * 执行函数的弹窗：上半部分填参数（对象参数可以「选择」：搜对象或从属性里选），下半部分是这次的执行结果
 * （成功或失败、用时、返回值、输出参数）。参数在外面按函数记着，关了再开、改了再执行都还在。
 * 非蓝图函数（受保护、私有、没开放给蓝图的）只在这里你自己点时能执行，Agent 调不了（用户 2026-11-11 定）
 */
export function FnDialog({
  path,
  fn,
  args,
  setArgs,
  result,
  setResult,
  onClose,
}: {
  path: string
  fn: Fn
  args: Record<string, string>
  setArgs: (a: Record<string, string>) => void
  result?: FnResult
  setResult: (r: FnResult) => void
  onClose: () => void
}) {
  const { project, target } = useUe()
  const { ui, cn } = h()
  const { busy, run } = useAction()
  const [picking, setPicking] = useState('')
  const ins = fn.params.filter((p) => !p.out)
  const outs = fn.params.filter((p) => p.out)
  const exec = () =>
    run('call', async () => {
      // 空着的参数不发：桥接用默认值（零值）
      const given = Object.fromEntries(Object.entries(args).filter(([, v]) => v.trim() !== ''))
      const started = performance.now()
      try {
        const r = await op<{ ret?: unknown; out?: Record<string, unknown>; ms?: number }>(
          project.id,
          'call',
          { path, function: fn.name, args: given, ...(fn.blueprint === false ? { any: true } : {}) },
          target,
        )
        setResult({ ok: true, ret: r.ret, out: r.out, ms: r.ms ?? performance.now() - started })
      } catch (e) {
        setResult({ ok: false, error: (e as Error).message, ms: performance.now() - started })
      }
    })
  const label = 'ue:w-36 ue:shrink-0 ue:truncate ue:pt-1.5 ue:font-mono ue:text-caption ue:text-muted'
  return (
    <ui.Modal
      open
      size="lg"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={fn.name}
      footer={
        <>
          <ui.Button variant="secondary" onClick={onClose}>
            {t('关闭')}
          </ui.Button>
          <ui.Button disabled={busy === 'call'} onClick={() => void exec()}>
            <Play className="ue:h-3.5 ue:w-3.5" /> {busy === 'call' ? t('执行中…') : t('执行')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-3">
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:text-caption ue:text-subtle">
          <span className="ue:font-mono">{fn.owner}</span>
          {fn.blueprint === false && <Badge tone="warn">{t('非蓝图函数')}</Badge>}
          {fn.ret && <span className="ue:font-mono">→ {fn.ret}</span>}
        </div>
        {fn.tooltip && <p className="ue:text-footnote ue:text-subtle">{fn.tooltip}</p>}
        {fn.blueprint === false && (
          <p className="ue:text-footnote ue:text-subtle">
            {t('这个函数没有开放给蓝图，只能在这里手动执行，Agent 调用不了。')}
          </p>
        )}
        {!ins.length && <p className="ue:text-footnote ue:text-subtle">{t('没有参数')}</p>}
        {/* 不用 form：参数下面嵌着「选择」面板，它自己有搜索表单，form 套 form 回车会提交错（还会冒泡到 Object 页的搜索表单） */}
        <div className="ue:flex ue:flex-col ue:gap-2">
          {ins.map((p) => (
            <div key={p.name} className="ue:flex ue:flex-col ue:gap-2">
              <div className="ue:flex ue:items-start ue:gap-2">
                <span className={label} title={`${p.type} ${p.name}`}>
                  {p.name}
                </span>
                {p.enum ? (
                  <ui.Select
                    size="sm"
                    className="ue:flex-1"
                    value={args[p.name] ?? ''}
                    onChange={(e: { target: { value: string } }) => setArgs({ ...args, [p.name]: e.target.value })}
                    options={[{ value: '', label: t('默认') }, ...p.enum.map((v) => ({ value: v, label: v }))]}
                  />
                ) : (
                  <ui.Input
                    size="sm"
                    className="ue:flex-1 ue:font-mono"
                    placeholder={p.objectClass ? t('{c} 的对象路径', { c: p.objectClass }) : p.type}
                    value={args[p.name] ?? ''}
                    onChange={(e: { target: { value: string } }) => setArgs({ ...args, [p.name]: e.target.value })}
                    onKeyDown={(e: { key: string; preventDefault: () => void }) => {
                      // 参数框里回车直接执行
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void exec()
                      }
                    }}
                  />
                )}
                {p.objectClass && (
                  <ui.Button
                    size="sm"
                    variant={picking === p.name ? 'primary' : 'secondary'}
                    onClick={() => setPicking(picking === p.name ? '' : p.name)}
                  >
                    {t('选择')}
                  </ui.Button>
                )}
              </div>
              {picking === p.name && p.objectClass && (
                <ObjectArg
                  cls={p.objectClass}
                  clsPath={p.objectClassPath}
                  self={path}
                  onPick={(v) => {
                    setArgs({ ...args, [p.name]: v })
                    setPicking('')
                  }}
                />
              )}
            </div>
          ))}
        </div>
        {result && (
          <section className="ue:flex ue:flex-col ue:gap-2 ue:border-t ue:border-line ue:pt-3">
            <div className="ue:flex ue:items-center ue:gap-2 ue:text-footnote">
              {result.ok ? (
                <CheckCircle2 className="ue:h-4 ue:w-4 ue:text-success" />
              ) : (
                <XCircle className="ue:h-4 ue:w-4 ue:text-danger" />
              )}
              <span className={cn('ue:font-medium', result.ok ? 'ue:text-fg' : 'ue:text-danger')}>
                {result.ok ? t('执行成功') : t('执行失败')}
              </span>
              {result.ms !== undefined && (
                <span className="ue:text-subtle">
                  {t('用时 {ms} 毫秒', { ms: result.ms.toFixed(result.ms < 10 ? 2 : 0) })}
                </span>
              )}
            </div>
            {!result.ok && (
              <Term className="ue:max-h-40">
                <pre className="ue:whitespace-pre-wrap ue:text-danger">{result.error}</pre>
              </Term>
            )}
            {result.ok && fn.ret && (
              <div className="ue:flex ue:flex-col ue:gap-1">
                <span className="ue:text-caption ue:text-subtle">{t('返回值')}</span>
                <Term className="ue:max-h-40">
                  <pre className="ue:whitespace-pre-wrap">{fmt(result.ret)}</pre>
                </Term>
              </div>
            )}
            {result.ok && outs.length > 0 && (
              <div className="ue:flex ue:flex-col ue:gap-1">
                <span className="ue:text-caption ue:text-subtle">{t('输出参数')}</span>
                <Term className="ue:max-h-40">
                  <pre className="ue:whitespace-pre-wrap">{fmt(result.out ?? {})}</pre>
                </Term>
              </div>
            )}
            {result.ok && !fn.ret && !outs.length && (
              <p className="ue:text-footnote ue:text-subtle">{t('这个函数没有返回值和输出参数')}</p>
            )}
          </section>
        )}
      </div>
    </ui.Modal>
  )
}
