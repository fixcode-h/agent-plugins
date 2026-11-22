import {
  ArrowDown,
  ArrowUp,
  Check,
  CirclePlus,
  Hourglass,
  MessageSquarePlus,
  Pencil,
  Play,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { callText } from '../../../shared/gm/custom.ts'
import { customKey, type GmMacro } from '../../../shared/gm/schema.ts'
import { useAsk } from '../../ask.tsx'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Badge } from '../../ui.tsx'
import { cppLine, type GmEntry } from './data.ts'
import { preview, runMacro, type MacroStepResult } from './run.ts'

type Step = GmMacro['steps'][number]
type StepResult = MacroStepResult

const listArgs = (a: Step['args']) => (Array.isArray(a) ? a : [])

/** 一步怎么显示：Lua 按扫描结果拼出调用代码，C++ 是控制台写法，自定义 GM 是「在 对象 上调 函数(参数)」 */
export function stepText(s: Step, find: (key: string) => GmEntry | undefined) {
  if (s.wait !== undefined) return t('等 {n} 秒', { n: s.wait })
  if (s.console) return s.console
  if (s.custom) {
    const c = find(customKey(s.custom))?.custom
    if (!c) return t('自定义 GM 已经不在了（{id}）', { id: s.custom })
    return `${c.name}：${callText(c, { ...c.args, ...(Array.isArray(s.args) ? {} : s.args) })}`
  }
  if (s.lua) {
    const e = find(`lua:${s.lua}`)
    return (e && preview(e, listArgs(s.args)).code) || [s.lua, ...listArgs(s.args)].join(' ')
  }
  return cppLine(s.gm ?? '', listArgs(s.args))
}

/**
 * 右边编辑宏（效果图 2）：步骤可以混 C++ GM、Lua GM、自定义 GM 和控制台命令；在 GM 详情里点「加到宏」加进来，
 * 这里调顺序、删步骤、加命令。改了马上存进 gm.json（团队共用）；执行全部时任何一步失败就停，标出是哪一步
 */
export function MacroPane({
  macro,
  find,
  onSave,
  onDelete,
  canRun,
  toChat,
}: {
  macro: GmMacro
  find: (key: string) => GmEntry | undefined
  onSave: (m: GmMacro) => Promise<unknown>
  onDelete: () => void
  canRun: string
  toChat?: (text: string) => void
}) {
  const { project, target } = useUe()
  const { ui, cn } = h()
  const [cmd, setCmd] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ macro: string; steps: StepResult[]; error?: string }>()
  const [dialog, ask] = useAsk()
  const steps = macro.steps
  const set = (next: Step[]) => void onSave({ ...macro, steps: next })
  const move = (i: number, d: number) => {
    const next = [...steps]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x)
    set(next)
  }
  const resOf = (i: number) => (res?.macro === macro.id ? res.steps.find((s) => s.step === i + 1) : undefined)
  const run = async () => {
    setBusy(true)
    try {
      const r = await runMacro(project.id, macro.id, target)
      setRes({
        macro: macro.id,
        steps: r.steps,
        error: r.ok
          ? undefined
          : r.failed?.length
            ? t('第 {n} 步失败，跳过接着执行完了', { n: r.failed.join('、') })
            : t('第 {n} 步失败，后面的没执行', { n: r.failedAt ?? 0 }),
      })
    } catch (e) {
      setRes({ macro: macro.id, steps: [], error: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const text = steps.map((s, i) => `${i + 1}. ${stepText(s, find)}`).join('\n')

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      {dialog}
      <header className="ue:flex ue:min-h-10 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-1.5">
        <span className="ue:truncate ue:text-body ue:font-medium ue:text-fg">{macro.name}</span>
        <button
          type="button"
          title={t('改名')}
          className="ue:grid ue:cursor-pointer ue:text-subtle ue:hover:text-fg"
          onClick={async () => {
            const name = await ask({ title: t('改名'), label: t('宏的名字'), init: macro.name })
            if (name?.trim()) void onSave({ ...macro, name: name.trim() })
          }}
        >
          <Pencil className="ue:h-3 ue:w-3" />
        </button>
        <Badge>{t('宏 · {n} 步', { n: steps.length })}</Badge>
      </header>
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-3 ue:overflow-auto ue:p-4">
        <div className="ue:rounded-lg ue:border ue:border-line">
          {steps.map((s, i) => {
            const r = resOf(i)
            const out = r ? (r.ok ? (r.output ?? []).join(' ') : (r.error ?? '')) : ''
            return (
              <div
                key={i}
                className="ue:group ue:flex ue:min-h-10 ue:items-center ue:gap-2 ue:border-b ue:border-line/60 ue:px-3 ue:last:border-b-0"
              >
                <span className="ue:w-4 ue:shrink-0 ue:text-caption ue:text-subtle">{i + 1}</span>
                <Badge tone={s.lua || s.custom ? 'accent' : 'muted'}>
                  {s.wait !== undefined
                    ? t('等待')
                    : s.console
                      ? t('命令')
                      : s.custom
                        ? t('自定义')
                        : s.lua
                          ? 'Lua'
                          : 'C++'}
                </Badge>
                <code className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-footnote ue:text-fg">
                  {stepText(s, find)}
                </code>
                {r && (
                  <>
                    <span
                      className={cn(
                        'ue:max-w-56 ue:truncate ue:text-caption',
                        r.ok ? 'ue:text-subtle' : 'ue:text-danger',
                      )}
                      title={out}
                    >
                      {out}
                    </span>
                    {r.ok ? (
                      <Check className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-success" />
                    ) : (
                      <X className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-danger" />
                    )}
                  </>
                )}
                <span className="ue:flex ue:shrink-0 ue:gap-1 ue:text-subtle ue:opacity-0 ue:group-hover:opacity-100 ue:focus-within:opacity-100">
                  <button
                    type="button"
                    title={t('上移')}
                    disabled={!i}
                    onClick={() => move(i, -1)}
                    className="ue:grid ue:cursor-pointer ue:hover:text-fg ue:disabled:opacity-30"
                  >
                    <ArrowUp className="ue:h-3.5 ue:w-3.5" />
                  </button>
                  <button
                    type="button"
                    title={t('下移')}
                    disabled={i === steps.length - 1}
                    onClick={() => move(i, 1)}
                    className="ue:grid ue:cursor-pointer ue:hover:text-fg ue:disabled:opacity-30"
                  >
                    <ArrowDown className="ue:h-3.5 ue:w-3.5" />
                  </button>
                  <button
                    type="button"
                    title={t('删掉这一步')}
                    onClick={() => set(steps.filter((_, k) => k !== i))}
                    className="ue:grid ue:cursor-pointer ue:hover:text-danger"
                  >
                    <Trash2 className="ue:h-3.5 ue:w-3.5" />
                  </button>
                </span>
              </div>
            )
          })}
          {!steps.length && <p className="ue:px-3 ue:py-3 ue:text-footnote ue:text-subtle">{t('还没有步骤')}</p>}
        </div>
        <form
          className="ue:flex ue:items-center ue:gap-2 ue:text-footnote ue:text-subtle"
          onSubmit={(e) => {
            e.preventDefault()
            if (!cmd.trim()) return
            set([...steps, { console: cmd.trim() }])
            setCmd('')
          }}
        >
          <CirclePlus className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
          <span className="ue:shrink-0">
            {t('在 GM 详情里点「加到宏」把 GM 连同当前参数加进来；或者加一条控制台命令：')}
          </span>
          <ui.Input
            size="sm"
            className="ue:min-w-0 ue:flex-1 ue:font-mono"
            value={cmd}
            placeholder="slomo 0.5"
            onChange={(e: { target: { value: string } }) => setCmd(e.target.value)}
          />
        </form>
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:text-footnote ue:text-subtle">
          <ui.Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const v = await ask({ title: t('加一步等待'), label: t('等几秒（最多 600）'), init: '1' })
              const n = Number(v)
              if (v === undefined || !Number.isFinite(n) || n < 0) return
              set([...steps, { wait: Math.min(n, 600) }])
            }}
          >
            <Hourglass className="ue:h-3.5 ue:w-3.5" /> {t('加一步等待…')}
          </ui.Button>
          <span className="ue:ml-auto">{t('某步失败时')}</span>
          <ui.Segmented
            size="sm"
            label={t('某步失败时')}
            value={macro.onFail ?? 'stop'}
            onChange={(v: 'stop' | 'skip') => void onSave({ ...macro, onFail: v === 'stop' ? undefined : v })}
            options={[
              { id: 'stop' as const, label: t('停下') },
              { id: 'skip' as const, label: t('跳过继续') },
            ]}
          />
        </div>
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
          <ui.Button
            size="sm"
            disabled={busy || !steps.length || !!canRun}
            title={canRun || undefined}
            onClick={() => void run()}
          >
            <Play className="ue:h-3.5 ue:w-3.5" /> {t('执行全部')}
          </ui.Button>
          {toChat && (
            <ui.Button size="sm" variant="secondary" onClick={() => toChat(`${t('宏')}「${macro.name}」\n${text}`)}>
              <MessageSquarePlus className="ue:h-3.5 ue:w-3.5" /> {t('发给对话')}
            </ui.Button>
          )}
          <span className="ue:text-caption ue:text-subtle">
            {canRun ||
              (macro.onFail === 'skip'
                ? t('某步失败时跳过接着做，最后标出失败的步')
                : t('任何一步失败就停下，标出是哪一步'))}
          </span>
          <ui.Button size="sm" variant="ghost" className="ue:ml-auto ue:text-danger" onClick={onDelete}>
            <Trash2 className="ue:h-3.5 ue:w-3.5" /> {t('删除宏')}
          </ui.Button>
        </div>
        {res?.macro === macro.id && res.error && <p className="ue:text-footnote ue:text-danger">{res.error}</p>}
      </div>
    </div>
  )
}
