import { CircleCheck, CircleX, Loader2, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { invokesOf } from '../../../../shared/gm/custom.ts'
import { getAt, pathStr, type GtScript, type GtStep } from '../../../../shared/gt-script/index.ts'
import { ppost } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { CallOutput } from '../../../obj-kit/CallOutput.tsx'
import { agentLookPrompt } from '../gt-author/agent-look-prompt.ts'
import { useGtAgentChat } from '../gt-author/useGtAgentChat.tsx'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { faceOf } from '../gt-flow/faces.tsx'
import { evidenceOf, GtEvidence } from '../GtEvidence.tsx'
import { ValueTree } from '../value/ValueTree.tsx'
import type { StepTry } from './step-try.ts'
import { stepVars } from './VarsTable.tsx'

/** 回包里单独画的几项，其余的（找到的对象、读到的值……）按值树原样列 */
const SHOWN = new Set(['invoke', 'vars', 'varsTruncated', 'evidence'])

/**
 * 右栏「运行 → 这一步」（分析文档 U3、效果图 3）：最近一次「只做这一步」的结果。
 * 调函数的返回值、输出参数、在哪个对象上调的用 GM 的输出卡（obj-kit CallOutput，和对象调用同一套）；
 * 这一步用到的变量和其他回包按值树画；失败时带 GameTest 留的证据（截图、控件树、日志）和「让 Agent 看」
 * （定稿 11.1，以前在列表时代的步骤详情里，那块删了之后搬到这里）
 */
export function StepResult({
  project,
  doc,
  res,
  busy,
  onSelect,
}: {
  project: string
  doc?: GtScript
  res?: StepTry
  busy?: boolean
  onSelect?: (p: StepTry['path']) => void
}) {
  const { api, cn, ui } = h()
  const ctx = useEditCtx()
  const agent = useGtAgentChat()
  if (!res)
    return busy ? (
      <Spin />
    ) : (
      <p className="ue:px-4 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">
        {t('在检查器里点「只做这一步」，结果显示在这里')}
      </p>
    )
  const step = doc ? (getAt(doc, res.path) as GtStep | undefined) : undefined
  const face = step && typeof step === 'object' && step.action ? faceOf(step) : undefined
  const invoke = invokesOf({ payload: res.payload })
  const sv = stepVars(res.payload)
  const ev = res.ok ? undefined : evidenceOf(res.payload)
  const rest = Object.entries(res.payload ?? {}).filter(([k]) => !SHOWN.has(k))
  const fileUrl = (p: string) => api.url(`/p/${encodeURIComponent(project)}/ext/file?path=${encodeURIComponent(p)}`)
  const Icon = face?.icon
  const last = res.path[res.path.length - 1]
  const lookAgent = () =>
    agent.start(
      agentLookPrompt({
        scenario: { name: doc?.name ?? ctx.path ?? '', relativePath: ctx.path ?? '' },
        root: ctx.root,
        index: typeof last === 'number' ? last : 0,
        path: pathStr(res.path),
        def: step as Record<string, unknown> | undefined,
        action: step?.action,
        message: res.message,
        payload: res.payload,
        evidence: ev,
      }),
    )
  return (
    <div className={cn('ue:flex ue:flex-col ue:gap-3 ue:p-4', busy && 'ue:opacity-60')}>
      <div className="ue:flex ue:items-center ue:gap-2 ue:text-footnote">
        {res.pending ? (
          <Loader2 className="ue:h-4 ue:w-4 ue:shrink-0 ue:animate-spin ue:text-subtle" />
        ) : res.ok ? (
          <CircleCheck className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-success" />
        ) : (
          <CircleX className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-danger" />
        )}
        <button
          type="button"
          disabled={!onSelect}
          onClick={() => onSelect?.(res.path)}
          className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:text-left ue:enabled:cursor-pointer ue:enabled:hover:underline"
        >
          {Icon && <Icon className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', face.tone)} />}
          <span className="ue:truncate ue:font-medium ue:text-fg">{face?.title ?? t('这一步')}</span>
        </button>
        <span
          className={cn(
            'ue:ml-auto ue:shrink-0',
            res.pending ? 'ue:text-subtle' : res.ok ? 'ue:text-success' : 'ue:text-danger',
          )}
        >
          {res.pending ? t('在跑') : res.ok ? t('通过') : t('没通过')}
        </span>
        {!res.pending && <span className="ue:shrink-0 ue:font-mono ue:text-caption ue:text-subtle">{res.ms} ms</span>}
      </div>
      {face?.sub && <p className="ue:-mt-2 ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{face.sub}</p>}
      {res.pending && <p className="ue:text-footnote ue:text-subtle">{t('这一步要等几帧，跑完后结果显示在这里')}</p>}
      {!res.ok && !res.pending && res.message && (
        <p className="ue:whitespace-pre-wrap ue:break-words ue:text-footnote ue:text-danger">{res.message}</p>
      )}
      {/* 带上失败证据和这一步，用「游戏测试」角色开对话判断是游戏问题还是脚本问题 */}
      {!res.ok && !res.pending && ctx.path && agent.available && (
        <ui.Button size="sm" variant="secondary" className="ue:w-fit" onClick={lookAgent}>
          <Sparkles className="ue:h-3.5 ue:w-3.5" /> {t('让 Agent 看')}
        </ui.Button>
      )}
      {invoke.length > 0 && (
        <CallOutput
          out={{ ok: res.ok, error: res.ok ? undefined : res.message, invoke, ms: res.ms, at: res.at }}
          args={step?.args as Record<string, unknown> | undefined}
        />
      )}
      {res.ok && res.message && invoke.length === 0 && (
        <p className="ue:whitespace-pre-wrap ue:break-words ue:text-footnote ue:text-muted">{res.message}</p>
      )}
      {sv && (
        <Block title={sv.truncated ? t('这一步用到的变量（只列了一部分）') : t('这一步用到的变量')}>
          {Object.entries(sv.vars).map(([k, v]) => (
            <Row key={k} name={`$${k}`} value={v} project={project} />
          ))}
        </Block>
      )}
      {rest.length > 0 && (
        <Block title={t('其他结果')}>
          {rest.map(([k, v]) => (
            <Row key={k} name={k} value={v} project={project} />
          ))}
        </Block>
      )}
      {ev && (
        <GtEvidence
          e={ev}
          imageUrl={fileUrl}
          loadText={(file) => ppost<{ text: string; truncated?: boolean }>(project, 'ext/gt/text', { file })}
        />
      )}
      {agent.dialog}
    </div>
  )
}

const Spin = () => (
  <div className="ue:flex ue:justify-center ue:p-8 ue:text-subtle">
    <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin" />
  </div>
)

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ue:flex ue:flex-col ue:gap-1.5">
      <span className="ue:text-caption ue:text-subtle">{title}</span>
      <div className="ue:flex ue:flex-col ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:p-1">
        {children}
      </div>
    </section>
  )
}

/** 一项一棵值树，名字写在根行上；默认收起，要看哪个点开哪个 */
const Row = ({ name, value, project }: { name: string; value: unknown; project: string }) => (
  <ValueTree name={name} value={value} project={project} collapsed />
)
