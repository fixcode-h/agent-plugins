import { Fragment } from 'react'
import { CircleCheck, CircleDashed, CircleX, Crosshair, Loader2, TriangleAlert } from 'lucide-react'
import { useToChat } from '../../chat.tsx'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { ppost, show } from '../../api.ts'
import { Note, Term } from '../../ui.tsx'
import { evidenceOf, GtEvidence, type GtEvidenceData } from './GtEvidence.tsx'
import { ambiguousOf, hintOf, humanStep, type GtHint } from './gt-steps.ts'
import { stepTitle } from './gt-step-title.ts'

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
  /** 「核对选择器」（gt.resolve）里这一步的结果：target、拖动的 toTarget 各一条 */
  check?: GtResolveItem[]
}

/** 自动处理阻挡界面的一条记录（步骤结果的 payload.blockers） */
interface GtBlockerEvent {
  widget: string
  rule?: string
  action?: string
  ok?: boolean
  message?: string
  note?: string
}

/** gt.resolve 的一条：选择器此刻找不找得到；找不到时 error 里是候选 */
export interface GtResolveItem {
  target: string
  step?: number
  field?: string
  found: boolean
  path?: string
  class?: string
  text?: string
  visible?: boolean
  enabled?: boolean
  error?: string
}

/** 行里的核对标记：都找得到是准星，有找不到的是黄三角（悬停看是哪个） */
export function CheckMark({ check }: { check?: GtResolveItem[] }) {
  if (!check?.length) return null
  const missing = check.filter((c) => !c.found)
  return missing.length ? (
    <span title={t('此刻找不到：{s}', { s: missing.map((c) => c.target).join('、') })} className="ue:shrink-0">
      <TriangleAlert className="ue:h-3.5 ue:w-3.5 ue:text-danger" />
    </span>
  ) : (
    <span title={t('选择器此刻找得到')} className="ue:shrink-0">
      <Crosshair className="ue:h-3.5 ue:w-3.5 ue:text-success" />
    </span>
  )
}

export const ms = (n?: number) =>
  n === undefined ? '' : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`

export function StepIcon({ s, live }: { s?: string; live?: boolean }) {
  if (live) return <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin ue:text-warning" />
  if (s === 'succeeded') return <CircleCheck className="ue:h-3.5 ue:w-3.5 ue:text-success" />
  if (s === 'failed') return <CircleX className="ue:h-3.5 ue:w-3.5 ue:text-danger" />
  return <CircleDashed className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
}

/**
 * 一行里显示的说明：目标 + 说明 / 结果消息；没有目标时把关键参数拼一行（key、map、seconds……）。
 * 录制附了 hint 的 UI 步骤多一句人话（human），选择器退成次要信息；ambiguous 是录制时选择器没核对通过的原因
 */
export function rowSummary(r: StepRow) {
  const target = r.res?.target ?? (typeof r.def?.target === 'string' ? r.def.target : undefined)
  const note = r.res?.note ?? (typeof r.def?.note === 'string' ? r.def.note : undefined)
  const params = r.def ? paramsOf(r.def) : []
  const brief = params
    .filter(([k]) => k !== 'target' && k !== 'note' && k !== 'hint')
    .map(([k, v]) => `${k}=${show(v)}`)
    .join(' ')
  return {
    target,
    text: r.res?.message || note || brief,
    /** 场景里写的这一步的说明（AI 整理会给每步写一句中文） */
    note: typeof r.def?.note === 'string' && r.def.note.trim() ? r.def.note : undefined,
    human: humanStep(r.def),
    ambiguous: ambiguousOf(r.def),
  }
}

/** 步骤定义里除了 action 之外的字段，按场景文件里的顺序 */
const paramsOf = (def: StepDef) => Object.entries(def).filter(([k]) => k !== 'action')

/** 一步的详情：场景里写的参数，下面是这次运行的结果（状态、消息、截图、失败证据、payload） */
export function StepDetail({
  row,
  live,
  scenario,
}: {
  row: StepRow
  live?: boolean
  scenario?: { name: string; relativePath: string }
}) {
  const { project } = useUe()
  const { api } = h()
  const chat = useToChat()
  const { def, res } = row
  const evidence = evidenceOf(res?.payload)
  const fileUrl = (p: string) => api.url(`/p/${encodeURIComponent(project.id)}/ext/file?path=${encodeURIComponent(p)}`)
  const action = def?.action || res?.action || '?'
  // note 已经是标题、hint 在「控件」里分项列，参数里不再重复
  const params = def
    ? paramsOf(def).filter(([k]) => k !== 'note' && k !== 'hint')
    : ([
        ['target', res?.target],
        ['note', res?.note],
      ].filter(([, v]) => v) as [string, unknown][])
  const title = stepTitle(def, res?.action, res?.target)
  const human = humanStep(def)
  const hint = hintOf(def)
  const ambiguous = ambiguousOf(def)
  const picked = typeof res?.payload?.picked === 'string' ? res.payload.picked : undefined
  // GameTest 1.2.0-beta.6 起：这一步期间按运行配置自动关掉的阻挡界面
  const blockers = Array.isArray(res?.payload?.blockers) ? (res.payload.blockers as GtBlockerEvent[]) : []
  const shot = [res?.payload?.path, res?.payload?.screenshot, res?.payload?.annotated].find(
    (p): p is string => typeof p === 'string' && /\.(png|jpe?g)$/i.test(p),
  )
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-auto">
      <header className="ue:flex ue:flex-col ue:gap-1 ue:border-b ue:border-line ue:px-4 ue:py-3">
        <div className="ue:flex ue:items-center ue:gap-2 ue:text-caption ue:text-subtle">
          <StepIcon s={res?.status} live={live} />
          <span>{t('第 {n} 步', { n: row.i + 1 })}</span>
          <span className="ue:font-mono">{action}</span>
          <span className="ue:ml-auto ue:tabular-nums">{ms(res?.durationMs)}</span>
        </div>
        <p className="ue:text-body ue:font-medium ue:text-fg">{title}</p>
        {/* 标题用的是场景里写的说明时，按动作和控件生成的那句放下面对照 */}
        {human && typeof def?.note === 'string' && def.note.trim() && (
          <p className="ue:text-footnote ue:text-muted">{human}</p>
        )}
      </header>
      <Block title={t('结果')}>
        {res ? (
          <p className={res.status === 'failed' ? 'ue:text-danger' : 'ue:text-fg'}>
            {res.message || statusText(res.status)}
          </p>
        ) : (
          <p className="ue:text-subtle">{live ? t('等前面的步骤跑完') : t('这一步还没跑过')}</p>
        )}
        {picked && <p className="ue:text-subtle">{t('这次回放：{r}', { r: picked })}</p>}
      </Block>
      {(hint || ambiguous) && (
        <Block title={t('控件')}>
          {hint && <HintFields hint={hint} />}
          {ambiguous && (
            <Note>
              {t(
                '选择器可能不唯一：{r}。回放会先按录制时的位置和文字挑，挑不出时报错；这时改 target 或用「复制目标选择器」核对',
                {
                  r: ambiguous,
                },
              )}
            </Note>
          )}
        </Block>
      )}
      {blockers.length > 0 && (
        <Block title={t('自动处理的阻挡界面')}>
          {blockers.map((b, k) => (
            <p key={k} className="ue:flex ue:items-start ue:gap-1.5">
              {b.ok ? (
                <CircleCheck className="ue:mt-0.5 ue:h-3 ue:w-3 ue:shrink-0 ue:text-success" />
              ) : (
                <TriangleAlert className="ue:mt-0.5 ue:h-3 ue:w-3 ue:shrink-0 ue:text-warning" />
              )}
              <span className="ue:min-w-0">
                <span className="ue:font-mono ue:text-fg">{b.widget}</span>{' '}
                <span className="ue:text-subtle">
                  {b.message}
                  {b.note ? ` · ${b.note}` : ''}
                </span>
              </span>
            </p>
          ))}
        </Block>
      )}
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
      {row.check?.length ? (
        <Block title={t('选择器核对')}>
          {row.check.map((c, k) => (
            <div key={k} className="ue:flex ue:flex-col ue:gap-0.5">
              <span className="ue:flex ue:items-center ue:gap-1.5">
                <CheckMark check={[c]} />
                <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-fg">{c.target}</span>
                {c.field && c.field !== 'target' && <span className="ue:text-subtle">{c.field}</span>}
              </span>
              {c.found ? (
                <span className="ue:text-muted">
                  {t('找得到：{c}{v}', {
                    c: c.class ?? '?',
                    v: c.visible === false ? t('（不可见）') : c.enabled === false ? t('（禁用）') : '',
                  })}
                  {c.path && <span className="ue:ml-1 ue:font-mono ue:text-subtle">{c.path}</span>}
                </span>
              ) : (
                <span className="ue:whitespace-pre-wrap ue:break-all ue:text-danger">{c.error}</span>
              )}
            </div>
          ))}
        </Block>
      ) : null}
      {evidence && (
        <GtEvidence
          e={evidence}
          imageUrl={fileUrl}
          loadText={(file) => ppost<{ text: string; truncated?: boolean }>(project.id, 'ext/gt/text', { file })}
          onAgent={chat.available ? () => chat.send(agentText(row, evidence, scenario)) : undefined}
        />
      )}
      {shot && (
        <img
          alt={t('步骤截图')}
          src={fileUrl(shot)}
          className="ue:mx-4 ue:mt-3 ue:rounded-lg ue:border ue:border-line"
        />
      )}
      {chat.dialog}
      {res?.payload && Object.keys(res.payload).length > 0 && (
        <div className="ue:flex ue:flex-col ue:gap-1.5 ue:p-4">
          <h3 className="ue:text-caption ue:font-medium ue:text-subtle">{t('原始返回')}</h3>
          <Term>
            <pre className="ue:whitespace-pre-wrap">{JSON.stringify(res.payload, null, 2)}</pre>
          </Term>
        </div>
      )}
    </div>
  )
}

/** 「交给 Agent」放进对话输入框的话（发给 Agent 的提示词不翻译）：证据路径和场景文件，让它先读文件再判断 */
function agentText(row: StepRow, e: GtEvidenceData, scenario?: { name: string; relativePath: string }) {
  const files = [
    e.screenshot && `截图 ${e.screenshot}`,
    e.widgets && `控件快照 ${e.widgets}`,
    e.log && `失败前后的日志 ${e.log}`,
  ].filter(Boolean)
  return [
    `GameTest 场景「${scenario?.name ?? '?'}」第 ${row.i + 1} 步（${row.def?.action || row.res?.action || '?'}）失败：${row.res?.message ?? ''}`,
    `失败证据（路径相对 UE 项目根）：${files.join('，')}。${e.selectorError ? `当时选择器找不到控件：${e.selectorError}` : e.target ? '当时选择器找得到控件，说明控件在但这一步没成。' : ''}`,
    `请先读这些文件，结合场景文件 ${scenario?.relativePath ?? ''}（场景根下）找出失败原因，告诉我是测试写得不对还是游戏有问题、该怎么改；需要时用 ue_gametest resolve 核对选择器、step 单步复现。`,
  ].join('\n')
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

/** hint 分项列：录制时这个控件在哪个界面资源、什么类、显示什么字、在画面的哪块 */
function HintFields({ hint }: { hint: GtHint }) {
  const rect = hint.rect?.length === 4 ? hint.rect : undefined
  const items: [string, string | undefined][] = [
    [t('文字'), hint.text],
    [t('类'), hint.class],
    [t('界面资源'), hint.asset],
    [
      t('位置'),
      rect &&
        t('左上 ({x}%, {y}%)，宽 {w}%，高 {h}%', {
          x: pc(rect[0]),
          y: pc(rect[1]),
          w: pc(rect[2]),
          h: pc(rect[3]),
        }),
    ],
    [t('回放怎么挑'), hint.pick],
  ]
  return (
    <dl className="ue:grid ue:grid-cols-[minmax(64px,auto)_1fr] ue:gap-x-3 ue:gap-y-1.5">
      {items
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <Fragment key={k}>
            <dt className="ue:text-subtle">{k}</dt>
            <dd className="ue:min-w-0 ue:break-all ue:text-fg">{v}</dd>
          </Fragment>
        ))}
    </dl>
  )
}

const pc = (v: number) => (Math.round(v * 1000) / 10).toString()
