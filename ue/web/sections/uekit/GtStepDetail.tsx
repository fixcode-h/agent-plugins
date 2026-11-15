import { CircleCheck, CircleDashed, CircleX, Loader2 } from 'lucide-react'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { show } from '../../api.ts'
import { Term } from '../../ui.tsx'

/**
 * GameTest 一步的两份数据：场景文件里写的（def：动作和参数），这次运行的结果（res：状态、消息、payload、耗时）。
 * 没跑过的场景只有 def，`gt.run` 直接给步骤的临时运行只有 res，两份按行号对齐后一起显示
 */
export interface GtStep {
  index: number
  action: string
  status: 'succeeded' | 'failed' | 'skipped' | 'pending' | string
  message?: string
  target?: string
  note?: string
  payload?: Record<string, unknown>
  durationMs?: number
}

export interface StepDef {
  action: string
  [k: string]: unknown
}

export interface StepRow {
  /** 场景里的第几步（0 起） */
  i: number
  def?: StepDef
  res?: GtStep
}

export const ms = (n?: number) =>
  n === undefined ? '' : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`

export function StepIcon({ s, live }: { s?: string; live?: boolean }) {
  if (live) return <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin ue:text-warning" />
  if (s === 'succeeded') return <CircleCheck className="ue:h-3.5 ue:w-3.5 ue:text-success" />
  if (s === 'failed') return <CircleX className="ue:h-3.5 ue:w-3.5 ue:text-danger" />
  return <CircleDashed className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
}

/** 一行里显示的说明：目标 + 说明 / 结果消息；没有目标时把关键参数拼一行（key、map、seconds……） */
export function rowSummary(r: StepRow) {
  const target = r.res?.target ?? (typeof r.def?.target === 'string' ? r.def.target : undefined)
  const note = r.res?.note ?? (typeof r.def?.note === 'string' ? r.def.note : undefined)
  const params = r.def ? paramsOf(r.def) : []
  const brief = params
    .filter(([k]) => k !== 'target' && k !== 'note')
    .map(([k, v]) => `${k}=${show(v)}`)
    .join(' ')
  return { target, text: r.res?.message || note || brief }
}

/** 步骤定义里除了 action 之外的字段，按场景文件里的顺序 */
const paramsOf = (def: StepDef) => Object.entries(def).filter(([k]) => k !== 'action')

/** 一步的详情：场景里写的参数，下面是这次运行的结果（状态、消息、截图、payload） */
export function StepDetail({ row, live }: { row: StepRow; live?: boolean }) {
  const { project } = useUe()
  const { api } = h()
  const { def, res } = row
  const action = def?.action || res?.action || '?'
  const params = def
    ? paramsOf(def)
    : ([
        ['target', res?.target],
        ['note', res?.note],
      ].filter(([, v]) => v) as [string, unknown][])
  const shot = [res?.payload?.path, res?.payload?.screenshot, res?.payload?.annotated].find(
    (p): p is string => typeof p === 'string' && /\.(png|jpe?g)$/i.test(p),
  )
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-auto">
      <header className="ue:flex ue:min-h-12 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2">
        <span className="ue:text-caption ue:text-subtle">{t('第 {n} 步', { n: row.i + 1 })}</span>
        <span className="ue:font-mono ue:text-body ue:font-medium ue:text-fg">{action}</span>
        <StepIcon s={res?.status} live={live} />
        <span className="ue:ml-auto ue:text-caption ue:text-subtle">{ms(res?.durationMs)}</span>
      </header>
      <Block title={t('参数')}>
        {params.length ? (
          <dl className="ue:grid ue:grid-cols-[minmax(64px,auto)_1fr] ue:gap-x-3 ue:gap-y-1.5">
            {params.map(([k, v]) => (
              <Pair key={k} k={k} v={v} />
            ))}
          </dl>
        ) : (
          <p className="ue:text-subtle">{t('这一步没有参数')}</p>
        )}
      </Block>
      <Block title={t('结果')}>
        {res ? (
          <p className={res.status === 'failed' ? 'ue:text-danger' : 'ue:text-fg'}>
            {res.message || statusText(res.status)}
          </p>
        ) : (
          <p className="ue:text-subtle">{live ? t('等前面的步骤跑完') : t('这一步还没跑过')}</p>
        )}
      </Block>
      {shot && (
        <img
          alt={t('步骤截图')}
          src={api.url(`/p/${encodeURIComponent(project.id)}/ext/file?path=${encodeURIComponent(shot)}`)}
          className="ue:mx-4 ue:mt-3 ue:rounded-lg ue:border ue:border-line"
        />
      )}
      {res?.payload && Object.keys(res.payload).length > 0 && (
        <div className="ue:p-4">
          <Term>
            <pre className="ue:whitespace-pre-wrap">{JSON.stringify(res.payload, null, 2)}</pre>
          </Term>
        </div>
      )}
    </div>
  )
}

const statusText = (s: string) =>
  s === 'succeeded' ? t('通过') : s === 'failed' ? t('失败') : s === 'skipped' ? t('跳过') : t('进行中')

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ue:flex ue:flex-col ue:gap-1.5 ue:border-b ue:border-line ue:px-4 ue:py-3 ue:text-footnote">
      <h3 className="ue:text-caption ue:font-medium ue:text-subtle">{title}</h3>
      {children}
    </section>
  )
}

function Pair({ k, v }: { k: string; v: unknown }) {
  const mono = k === 'target' || typeof v !== 'string'
  return (
    <>
      <dt className="ue:font-mono ue:text-subtle">{k}</dt>
      <dd className={mono ? 'ue:min-w-0 ue:font-mono ue:break-all ue:text-fg' : 'ue:min-w-0 ue:text-fg'}>{show(v)}</dd>
    </>
  )
}
