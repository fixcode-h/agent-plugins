import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { op } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { ErrorText } from '../../ui.tsx'

/**
 * GameTest 的项目运行配置（场景根的 _settings.json，GameTest 1.2.0-beta.6 的 gt.config）：
 * UI 等待上限、阻挡界面规则。跟着场景进版本管理、全组共用，所以存在 UE 那边的场景根里，不存面板设置。
 */
export interface GtBlockerRule {
  widget: string
  action: 'close' | 'call' | 'command'
  function?: string
  command?: string
  note?: string
  delayMs?: number
  enabled?: boolean
}

interface GtRunConfig {
  uiWaitTimeoutMs?: number
  /** click 没写 via 时的点击方式（GameTest 1.2.0-beta.7）：code 不动鼠标（默认），pointer 真实鼠标 */
  clickVia?: 'code' | 'pointer'
  blockers: GtBlockerRule[]
}

interface ConfigReply {
  path: string
  exists: boolean
  config: GtRunConfig
  settingsUiWaitTimeoutMs: number
}

const blank = (): GtBlockerRule => ({ widget: '', action: 'close' })

/** 等待上限的显示：0 是不限 */
function waitText(ms: number) {
  return ms > 0 ? t('{s} 秒', { s: ms / 1000 }) : t('不限')
}

export function GtSettings({ onClose }: { onClose: () => void }) {
  const { project } = useUe()
  const { ui, cn } = h()
  const [reply, setReply] = useState<ConfigReply>()
  const [wait, setWait] = useState('')
  const [clickVia, setClickVia] = useState<'code' | 'pointer'>('code')
  const [rules, setRules] = useState<GtBlockerRule[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    op<ConfigReply>(project.id, 'gt.config')
      .then((r) => {
        setReply(r)
        setWait(r.config.uiWaitTimeoutMs === undefined ? '' : String(r.config.uiWaitTimeoutMs / 1000))
        setRules(r.config.blockers ?? [])
        setClickVia(r.config.clickVia ?? 'code')
      })
      .catch((e: Error) => setError(e.message))
  }, [project.id])

  const patch = (i: number, p: Partial<GtBlockerRule>) => setRules(rules.map((r, k) => (k === i ? { ...r, ...p } : r)))

  const save = async () => {
    const seconds = wait.trim() === '' ? undefined : Number(wait)
    if (seconds !== undefined && (!Number.isFinite(seconds) || seconds < 0)) {
      setError(t('等待上限要填不小于 0 的秒数，0 是不限'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const config: GtRunConfig = {
        ...(seconds === undefined ? {} : { uiWaitTimeoutMs: Math.round(seconds * 1000) }),
        // 默认就是 code：只在改成真实鼠标时写进文件，文件里不留没意义的默认值
        ...(clickVia === 'pointer' ? { clickVia } : {}),
        // 空行不存：点了「添加」没填的不该让整份配置保存失败
        blockers: rules.filter((r) => r.widget.trim()).map((r) => ({ ...r, widget: r.widget.trim() })),
      }
      await op(project.id, 'gt.config', { config })
      h().toast.success(t('已保存，下次运行生效'))
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const label = 'ue:text-caption ue:text-subtle'
  return (
    <ui.Modal
      open
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('GameTest 运行设置')}
      footer={
        <>
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button disabled={!reply || saving} onClick={() => void save()}>
            {t('保存')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-4 ue:text-body">
        <ui.Field
          label={t('UI 等待上限（秒）')}
          hint={t('点击、输入、等界面出现时最多等多久，0 是一直等到界面出现（卡住时点停止）。空着用项目设置：{d}', {
            d: waitText(reply?.settingsUiWaitTimeoutMs ?? 0),
          })}
        >
          <ui.Input
            size="sm"
            className="ue:w-32"
            inputMode="decimal"
            placeholder={t('默认')}
            value={wait}
            onChange={(e: { target: { value: string } }) => setWait(e.target.value)}
          />
        </ui.Field>

        <ui.Field
          label={t('点击方式')}
          hint={t(
            '不动鼠标：直接调按钮的点击（按下、点击、松开），找不到按钮时发虚拟鼠标事件，回放时可以照常用鼠标。真实鼠标：移光标按下松开，能测出遮挡和悬停，但回放时别动鼠标。单个步骤写 via 时以步骤为准。',
          )}
        >
          <ui.Select
            size="sm"
            className="ue:w-48"
            value={clickVia}
            onChange={(e: { target: { value: string } }) => setClickVia(e.target.value as 'code' | 'pointer')}
            options={[
              { value: 'code', label: t('不动鼠标（默认）') },
              { value: 'pointer', label: t('真实鼠标') },
            ]}
          />
        </ui.Field>

        <section className="ue:flex ue:flex-col ue:gap-2">
          <div className="ue:flex ue:items-center ue:gap-2">
            <h3 className="ue:text-body ue:font-medium ue:text-fg">{t('阻挡界面')}</h3>
            <ui.Button size="sm" variant="ghost" className="ue:ml-auto" onClick={() => setRules([...rules, blank()])}>
              <Plus className="ue:h-3.5 ue:w-3.5" /> {t('添加')}
            </ui.Button>
          </div>
          <p className="ue:text-footnote ue:leading-relaxed ue:text-subtle">
            {t(
              '公告、新手引导、活动弹窗这类不定时弹出的界面：跑测试时一出现就按规则处理掉，不让它挡住后面的步骤。正在等的那一步要点的就是它时不处理；每次处理都记在那一步的结果里。',
            )}
          </p>
          {!rules.length && (
            <p className="ue:rounded-(--c-row-radius) ue:border ue:border-dashed ue:border-line ue:px-3 ue:py-4 ue:text-center ue:text-footnote ue:text-subtle">
              {t('还没有规则')}
            </p>
          )}
          {rules.map((r, i) => (
            <div
              key={i}
              className={cn(
                'ue:flex ue:flex-col ue:gap-2 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:p-2.5',
                r.enabled === false && 'ue:opacity-60',
              )}
            >
              <div className="ue:flex ue:items-center ue:gap-2">
                <ui.Input
                  size="sm"
                  className="ue:min-w-0 ue:flex-1 ue:font-mono"
                  placeholder={t('WBP 类名或资产路径，例如 WBP_Notice')}
                  value={r.widget}
                  onChange={(e: { target: { value: string } }) => patch(i, { widget: e.target.value })}
                />
                <ui.Select
                  size="sm"
                  className="ue:w-36"
                  value={r.action}
                  onChange={(e: { target: { value: string } }) =>
                    patch(i, { action: e.target.value as GtBlockerRule['action'] })
                  }
                  options={[
                    { value: 'close', label: t('关闭') },
                    { value: 'call', label: t('调用函数') },
                    { value: 'command', label: t('执行指令') },
                  ]}
                />
                <ui.IconButton
                  icon={Trash2}
                  size="sm"
                  label={t('删除这条')}
                  onClick={() => setRules(rules.filter((_, k) => k !== i))}
                />
              </div>
              {r.action === 'call' && (
                <ui.Input
                  size="sm"
                  className="ue:font-mono"
                  placeholder={t('界面上的无参函数名，例如 Close')}
                  value={r.function ?? ''}
                  onChange={(e: { target: { value: string } }) => patch(i, { function: e.target.value })}
                />
              )}
              {r.action === 'command' && (
                <ui.Input
                  size="sm"
                  className="ue:font-mono"
                  placeholder={t('控制台指令或 GM，例如 gm.SkipGuide')}
                  value={r.command ?? ''}
                  onChange={(e: { target: { value: string } }) => patch(i, { command: e.target.value })}
                />
              )}
              <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
                <span className={label}>{t('出现后等')}</span>
                <ui.Input
                  size="sm"
                  className="ue:w-20"
                  inputMode="numeric"
                  value={String(r.delayMs ?? 0)}
                  onChange={(e: { target: { value: string } }) =>
                    patch(i, { delayMs: Math.max(0, Math.round(Number(e.target.value) || 0)) })
                  }
                />
                <span className={label}>{t('毫秒再处理')}</span>
                <ui.Input
                  size="sm"
                  className="ue:min-w-0 ue:flex-1"
                  placeholder={t('说明（可选）')}
                  value={r.note ?? ''}
                  onChange={(e: { target: { value: string } }) => patch(i, { note: e.target.value || undefined })}
                />
                <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1.5 ue:text-footnote ue:text-fg">
                  <input
                    type="checkbox"
                    className="ue:accent-(--accent)"
                    checked={r.enabled !== false}
                    onChange={(e) => patch(i, { enabled: e.target.checked ? undefined : false })}
                  />
                  {t('启用')}
                </label>
              </div>
            </div>
          ))}
        </section>

        {error && <ErrorText>{error}</ErrorText>}
        {reply && (
          <p className="ue:text-caption ue:text-subtle">
            {t('存在 {p}（跟着场景进版本管理，全组共用）', { p: reply.path })}
          </p>
        )}
      </div>
    </ui.Modal>
  )
}
