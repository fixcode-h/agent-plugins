import { Camera, CircleCheck, CircleDot, Flag, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { targetText } from './gt-ref/describe.ts'
import { Note } from '../../ui.tsx'
import { humanStep } from './gt-steps.ts'
import { moveLine } from './gt-move.ts'
import { byLabel, keyOf, type KeyAsk } from './gt-key.ts'
import { GtKeyAsk } from './GtKeyAsk.tsx'
import { GtRecordQuick, type RecordQuick } from './GtRecordQuick.tsx'

/**
 * 录制中的界面（效果图 5）：顶上红点、名字、时长和步数，检查点 / 截图检查点 / 停止并保存；
 * 下面是录到的步骤，最新一步高亮。步骤靠 gt.record 推送事件追加。
 */
export interface RecordStatus extends RecordQuick {
  recording: boolean
  name?: string
  steps?: number
  seconds?: number
  last?: Record<string, unknown>[]
  /** 录制器认「谁接住了输入」靠什么：slateDebugging 准；hitPath 是这个进程没编 Slate 调试，按命中路径推断 */
  handlerSource?: 'slateDebugging' | 'hitPath' | string
  keepPace?: boolean
  /** 正在暂停问某一步的条目怎么认（GameTest 1.4.0） */
  ask?: KeyAsk
  askKey?: string
  askTimeoutSec?: number
  /** 接着录（GameTest 1.10.0）：录到的段插进哪个场景的哪一步后面 */
  insert?: { scenario: string; after?: string }
  /** 录的是 UE 编辑器操作（gt.editrec.*，GameTest 1.11.0）；录游戏时没有 */
  target?: 'editor' | string
  /** 录编辑器时最近弹出的模态框标题 */
  modal?: string
}

/** handlerSource=hitPath 时的提示：开始录制前（对话框里）和录制中都显示 */
export function HitPathNote() {
  return (
    <Note>
      {t(
        '这个进程没编 Slate 调试（WITH_SLATE_DEBUGGING 关着），录制器只能按光标下的控件推断：点击照样能录，输入框里打的字录不到，要录输入换 Development 编辑器或手写 type 步骤',
      )}
    </Note>
  )
}

/** 条件里点名的控件（Alt+6 / Alt+7 录的条件是 {target, …}，按钮分支的第二条路是 all） */
const condTarget = (c: unknown) => (c && typeof c === 'object' ? (c as { target?: unknown }).target : undefined)

/** 录到的一步写成一行：有 hint 的 UI 步骤用人话（选择器放后面），其余列出参数 */
function describe(s: Record<string, unknown>) {
  if (s.action === 'move') return moveLine(s)
  // Alt+6 / Alt+7（GameTest 1.10.0）：条件对象原样列出来太长，写成人话
  if (s.action === 'if' && s.branch === 'state')
    return [t('按状态分支，各条路到编辑页里填'), condTarget(s.cond)].filter(Boolean).join(' · ')
  if (s.action === 'wait' && s.until === 'cond')
    return [t('等到'), condTarget(s.cond), s.note].filter(Boolean).join(' · ')
  const human = humanStep(s)
  if (human) return [human, targetText(s.target)].filter(Boolean).join(' · ')
  const rest = Object.entries(s)
    .filter(([k]) => k !== 'action' && k !== 'note' && k !== 'hint')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ')
  return [targetText(s.target), s.note as string | undefined, rest].filter(Boolean).join(' · ')
}

/** onDone：停止了；保存了时带上场景路径（相对场景根），父组件接着认截图里的字 */
/**
 * 录制时长：UE 只在录到步骤时推一次 seconds，中间不推心跳；面板按最近一次收到的值在本地往前走（只是显示，不问 UE），
 * 免得一直停在 0:00 像是卡住了
 */
function useRecordClock(seconds: number | undefined) {
  const base = useRef({ secs: 0, at: Date.now() })
  const [, tick] = useState(0)
  useEffect(() => {
    base.current = { secs: seconds ?? 0, at: Date.now() }
  }, [seconds])
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const secs = Math.max(0, Math.round(base.current.secs + (Date.now() - base.current.at) / 1000))
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

export function GtRecord({
  status,
  gtVersion,
  linked,
  onDone,
}: {
  status: RecordStatus
  gtVersion?: string
  /** 面板连没连上 UE 的推送通道；false 时录到的步骤到不了页面（停止后照样保存） */
  linked?: boolean
  onDone: (saved?: string) => void
}) {
  const { project } = useUe()
  const { ui, cn, toast } = h()
  const { busy, run } = useAction()
  const [mark, setMark] = useState('')
  // 录制中改前面某一步的条目标识（GameTest 1.5.0）：候选在那一步的 hint.key.cands 里
  const [editing, setEditing] = useState<KeyAsk>()
  // 停止失败、UE 也说不清现在录没录：给一个只关掉面板录制界面的出口，不让人卡在这一页
  const [stuck, setStuck] = useState('')
  const steps = status.last ?? []
  const time = useRecordClock(status.seconds)

  const addMark = (screenshot: boolean) =>
    run('mark', async () => {
      await op(project.id, 'gt.record.mark', { text: mark.trim() || t('检查点'), screenshot })
      setMark('')
    })
  const stop = (save: boolean) =>
    run('stop', async () => {
      let r: { path?: string; steps?: number; inserted?: boolean; warning?: string }
      try {
        r = await op(project.id, 'gt.record.stop', { save })
      } catch (e) {
        // UE 那边可能已经停了（游戏视口工具栏上点了停止、推送没到面板）：问一下现在的状态，没在录就直接退出
        const now = await op<{ recording?: boolean }>(project.id, 'gt.record.status', {}).catch(() => undefined)
        if (now && !now.recording) {
          toast.success(t('UE 那边已经停止录制了，录到的内容在场景根的 recorded/ 里'))
          onDone(undefined)
          return
        }
        setStuck((e as Error).message)
        return
      }
      setStuck('')
      if (save && r.path)
        toast.success(
          r.inserted
            ? t('已把 {n} 步作为一段插进 {p}', { n: r.steps ?? 0, p: r.path })
            : t('已保存 {n} 步到 {p}', { n: r.steps ?? 0, p: r.path }),
        )
      // 接着录时插不回原位置、或原场景写不进去另存了新文件：原样告诉用户
      if (r.warning) toast.error(r.warning)
      onDone(save ? r.path : undefined)
    })

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:bg-danger/8 ue:px-4 ue:py-2.5">
        <div className="ue:flex ue:items-center ue:gap-2.5">
          <span className="ue:h-2.5 ue:w-2.5 ue:shrink-0 ue:animate-pulse ue:rounded-full ue:bg-danger ue:ring-4 ue:ring-danger/20" />
          <span className="ue:truncate ue:text-body ue:font-medium ue:text-fg">
            {t('正在录制「{name}」', { name: status.name ?? '' })}
          </span>
          {status.insert && (
            <span className="ue:truncate ue:text-footnote ue:text-muted">
              {t('停止后插进 {p}', { p: status.insert.scenario })}
            </span>
          )}
          <span className="ue:shrink-0 ue:text-footnote ue:text-subtle ue:tabular-nums">
            {time} · {t('{n} 步', { n: status.steps ?? steps.length })}
            {status.keepPace ? ` · ${t('保留节奏')}` : ''}
          </span>
        </div>
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
          <ui.Input
            size="sm"
            className="ue:w-48"
            value={mark}
            placeholder={t('检查点说明（可不填）')}
            onChange={(e: { target: { value: string } }) => setMark(e.target.value)}
          />
          <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={() => addMark(false)}>
            <Flag className="ue:h-3.5 ue:w-3.5" /> {t('检查点')}
          </ui.Button>
          <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={() => addMark(true)}>
            <Camera className="ue:h-3.5 ue:w-3.5" /> {t('截图检查点')}
          </ui.Button>
          <span className="ue:flex-1" />
          <ui.Button size="sm" variant="ghost" disabled={!!busy} onClick={() => stop(false)}>
            {t('放弃')}
          </ui.Button>
          <ui.Button size="sm" variant="danger" disabled={!!busy} onClick={() => stop(true)}>
            <Square className="ue:h-3.5 ue:w-3.5" /> {t('停止并保存')}
          </ui.Button>
        </div>
        <GtRecordQuick status={status} gtVersion={gtVersion} />
        {stuck && (
          <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:text-footnote ue:text-danger">
            <span className="ue:min-w-0 ue:flex-1">{t('停止失败：{msg}', { msg: stuck })}</span>
            <ui.Button size="sm" variant="secondary" onClick={() => onDone(undefined)}>
              {t('只关掉这里的录制界面')}
            </ui.Button>
          </div>
        )}
      </div>
      {linked === false && (
        <div className="ue:border-b ue:border-line ue:px-4 ue:py-2">
          <Note>
            {t(
              '面板还没连上 UE 的推送通道，录到的步骤暂时显示不出来（UE 里照样在录，停止后照样保存）；连上后会自动补上',
            )}
          </Note>
        </div>
      )}
      <p className="ue:border-b ue:border-line ue:px-4 ue:py-2 ue:text-footnote ue:leading-relaxed ue:text-subtle">
        {t(
          '在游戏窗口里正常操作就行：点控件录成对这个控件的点击，打字录成输入，点在游戏画面上和按键录成真实按键；按住 Ctrl+Alt 点一个控件录成断言（这一下不传给游戏）。要让角色走到某处，点「录移动」再走过去、到了点「结束移动」，回放时角色自己寻路走过去。还有一个悬浮的工具栏小窗口（默认在游戏视口中下方，可以拖到视口外），鼠标被游戏锁住时按 Alt+数字；工具栏、快捷键本身和编辑器其他面板上的操作都不录。停止后存到场景根下的 recorded/。',
        )}
      </p>
      {status.handlerSource === 'hitPath' && (
        <div className="ue:border-b ue:border-line ue:px-4 ue:py-2">
          <HitPathNote />
        </div>
      )}
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
        {steps.map((s, i) => {
          const newest = i === steps.length - 1
          const index = (status.steps ?? steps.length) - steps.length + i
          const hint = s.hint && typeof s.hint === 'object' ? (s.hint as Record<string, unknown>) : undefined
          const key = keyOf(hint)
          return (
            <div
              key={i}
              className={cn(
                'ue:grid ue:h-9 ue:grid-cols-[22px_18px_104px_minmax(0,1fr)_auto] ue:items-center ue:gap-2 ue:border-b ue:border-line/55 ue:px-4',
                newest && 'ue:bg-run/8',
              )}
            >
              <span className="ue:text-right ue:text-caption ue:text-subtle ue:tabular-nums">{index + 1}</span>
              {newest ? (
                <CircleDot className="ue:h-3.5 ue:w-3.5 ue:text-danger" />
              ) : (
                <CircleCheck className="ue:h-3.5 ue:w-3.5 ue:text-success" />
              )}
              <span className="ue:truncate ue:font-mono ue:text-footnote ue:text-fg">{String(s.action ?? '')}</span>
              <span className="ue:truncate ue:text-footnote ue:text-muted">{describe(s)}</span>
              {key ? (
                <button
                  type="button"
                  title={t('改这一步在列表里怎么认：{c}', { c: key.cond || t('按位置') })}
                  disabled={!!status.ask}
                  onClick={() =>
                    setEditing({
                      step: index,
                      target: typeof s.target === 'string' ? s.target : '',
                      key,
                      shot: typeof hint?.shot === 'string' ? hint.shot : undefined,
                      text: typeof hint?.text === 'string' ? hint.text : undefined,
                    })
                  }
                  className={cn(
                    'ue:max-w-48 ue:truncate ue:rounded-sm ue:px-1.5 ue:py-0.5 ue:text-caption ue:hover:bg-hover',
                    key.by === 'pending' ? 'ue:text-warning' : 'ue:text-subtle',
                  )}
                >
                  {byLabel(key.by)}
                  {key.cond ? ` · ${key.cond}` : ''}
                </button>
              ) : (
                <span />
              )}
            </div>
          )
        })}
        {!steps.length && (
          <p className="ue:px-4 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">{t('还没录到操作')}</p>
        )}
        {editing && (
          <GtKeyAsk key={editing.step} project={project.id} ask={editing} edit onDone={() => setEditing(undefined)} />
        )}
      </div>
    </div>
  )
}
