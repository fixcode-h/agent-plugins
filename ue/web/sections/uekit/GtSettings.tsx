import { ListTree, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { op } from '../../api.ts'
import { ASSET_KINDS } from '../../asset-icons.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useSearchIndex } from '../../jump/index-data.ts'
import { AddButton, SettingGroup, SettingList, SettingRow } from '../../SettingRows.tsx'
import { SuggestInput, type SuggestRow } from '../../SuggestInput.tsx'
import { ErrorText } from '../../ui.tsx'
import { matchWidgets } from './gt-widget-match.ts'
import { type GtMoveConfig, GtMoveSettings, tidyMove } from './GtMoveSettings.tsx'
import { tidyKeyRules, type GtKeyRule } from './GtKeyRules.tsx'
import { parseSeed, parseSetup, SETUP_PLACEHOLDER, setupText } from './gt-setup.ts'

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
  /** 相邻两个 UI 操作之间至少隔多久（GameTest 1.2.6，毫秒）；没写按 1000 */
  uiStepGapMs?: number
  /** click 没写 via 时的点击方式（GameTest 1.2.0-beta.7）：code 不动鼠标（默认），pointer 真实鼠标 */
  clickVia?: 'code' | 'pointer'
  blockers: GtBlockerRule[]
  /** 前置步骤（GameTest 1.2.5）：从场景文件跑时先跑，放清引导、重置存档之类的 GM */
  setup?: Record<string, unknown>[]
  /** 开跑前固定引擎全局随机（GameTest 1.2.5） */
  randomSeed?: number
  /** move 步骤和录制快捷键（GameTest 1.3.0） */
  move?: GtMoveConfig
  /** 条目怎么认的规则（GameTest 1.4.0） */
  itemKeys?: GtKeyRule[]
}

interface ConfigReply {
  path: string
  exists: boolean
  config: GtRunConfig
  settingsUiWaitTimeoutMs: number
}

const blank = (): GtBlockerRule => ({ widget: '', action: 'close' })

const WIDGET_LIMIT = 50

/** 候选 → 下拉的行：按名字猜的（扫磁盘时没有类名）淡显 */
function widgetRows(m: ReturnType<typeof matchWidgets>): { rows: SuggestRow[]; total: number } {
  const { icon, tone } = ASSET_KINDS['umg-widget']
  return {
    total: m.total,
    rows: m.rows.map((w) => ({ key: w.pkg, value: w.value, label: w.name, detail: w.pkg, icon, tone, dim: !w.sure })),
  }
}

/** 等待上限的显示：0 是不限 */
function waitText(ms: number) {
  return ms > 0 ? t('{s} 秒', { s: ms / 1000 }) : t('不限')
}

/**
 * 两处用：GameTest 页的「运行设置」弹窗（给 onClose），UE 插件页里 GameTest 的设置页（不给，按节画成几张卡片、
 * 底部贴一条保存栏）。用户 2026-11-17 要每个插件有自己的设置页，两处是同一份表单、同一个文件；
 * 2026-11-18 嫌一项一摞（名字、输入框、长说明三行）太乱，改用 SettingRows 的两栏行，和面板画的插件参数一致
 */
export function GtSettings({ onClose, onOpenRules }: { onClose?: () => void; onOpenRules?: () => void }) {
  const { project } = useUe()
  const { ui, cn } = h()
  const [reply, setReply] = useState<ConfigReply>()
  const [wait, setWait] = useState('')
  const [gap, setGap] = useState('')
  const [clickVia, setClickVia] = useState<'code' | 'pointer'>('code')
  const [rules, setRules] = useState<GtBlockerRule[]>([])
  const [setup, setSetup] = useState('')
  const [seed, setSeed] = useState('')
  const [move, setMove] = useState<GtMoveConfig>({})
  const [keyRules, setKeyRules] = useState<GtKeyRule[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // 阻挡界面的 WBP 候选：跳转弹窗同一份本地索引，打开设置时取一次（没变只回 same），打字只在网页里筛
  const index = useSearchIndex(project.id)

  useEffect(() => {
    op<ConfigReply>(project.id, 'gt.config')
      .then((r) => {
        setReply(r)
        setWait(r.config.uiWaitTimeoutMs === undefined ? '' : String(r.config.uiWaitTimeoutMs / 1000))
        setGap(r.config.uiStepGapMs === undefined ? '' : String(r.config.uiStepGapMs / 1000))
        setRules(r.config.blockers ?? [])
        setClickVia(r.config.clickVia ?? 'code')
        setSetup(setupText(r.config.setup))
        setSeed(r.config.randomSeed === undefined ? '' : String(r.config.randomSeed))
        setMove(r.config.move ?? {})
        setKeyRules(r.config.itemKeys ?? [])
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
    const gapSeconds = gap.trim() === '' ? undefined : Number(gap)
    if (gapSeconds !== undefined && (!Number.isFinite(gapSeconds) || gapSeconds < 0 || gapSeconds > 60)) {
      setError(t('UI 操作间隔要填 0 到 60 之间的秒数，0 是不隔'))
      return
    }
    const setupParsed = parseSetup(setup)
    const seedParsed = parseSeed(seed)
    if (setupParsed.error || seedParsed.error) {
      setError((setupParsed.error ?? seedParsed.error)!)
      return
    }
    setSaving(true)
    setError('')
    try {
      const config: GtRunConfig = {
        ...(seconds === undefined ? {} : { uiWaitTimeoutMs: Math.round(seconds * 1000) }),
        ...(gapSeconds === undefined ? {} : { uiStepGapMs: Math.round(gapSeconds * 1000) }),
        // 默认就是 code：只在改成真实鼠标时写进文件，文件里不留没意义的默认值
        ...(clickVia === 'pointer' ? { clickVia } : {}),
        // 空行不存：点了「添加」没填的不该让整份配置保存失败
        blockers: rules.filter((r) => r.widget.trim()).map((r) => ({ ...r, widget: r.widget.trim() })),
        ...(setupParsed.steps?.length ? { setup: setupParsed.steps } : {}),
        ...(seedParsed.seed === undefined ? {} : { randomSeed: seedParsed.seed }),
        ...(tidyMove(move) ? { move: tidyMove(move) } : {}),
      }
      // 条目规则也在这份文件里、由规则面板和录制弹窗改：表单整份重写，保存前现取一遍最新的带上，不然就丢了
      const fresh = (await op<ConfigReply>(project.id, 'gt.config')).config.itemKeys ?? keyRules
      if (tidyKeyRules(fresh).length) config.itemKeys = tidyKeyRules(fresh)
      await op(project.id, 'gt.config', { config })
      h().toast.success(t('已保存，下次运行生效'))
      onClose?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const label = 'ue:text-footnote ue:text-subtle'
  const suggestWidgets = (q: string) => widgetRows(matchWidgets(index.idx, q, WIDGET_LIMIT))
  const indexStatus = index.error
    ? t('读索引失败：{e}', { e: index.error })
    : !index.idx
      ? t('正在读资源索引…')
      : t('{src} · 控件蓝图 {n} 个', {
          src: index.idx.source.assets === 'uetovs' ? t('来自 UEToVS 索引') : t('扫磁盘'),
          n: matchWidgets(index.idx, '', 0).all,
        })
  // 弹窗里不写「存在哪」（弹窗底下有一行），设置页里写在第一组的组名旁边
  const framed = !!onClose
  const where = t('这个项目 · 存在场景根的 _settings.json，全组共用')
  const sections = (
    <>
      <SettingGroup title={t('回放')} aside={framed ? undefined : where}>
        <SettingRow
          title={t('UI 等待上限（秒）')}
          desc={t('点击、输入、等界面出现时最多等多久')}
          hint={t('0 是一直等到界面出现（卡住时点停止）。空着用项目设置：{d}', {
            d: waitText(reply?.settingsUiWaitTimeoutMs ?? 0),
          })}
        >
          <ui.Input
            size="sm"
            className="ue:w-full"
            inputMode="decimal"
            placeholder={t('默认')}
            value={wait}
            onChange={(e: { target: { value: string } }) => setWait(e.target.value)}
          />
        </SettingRow>
        <SettingRow
          title={t('UI 操作间隔（秒）')}
          desc={t('回放时相邻两个 UI 操作至少隔多久')}
          hint={t(
            '回放时相邻两个 UI 操作（点击、拖动、输入、选择……）之间至少隔多久，和录制时点得多快无关；中间等待步骤用掉的时间也算。0 是不隔，空着按 1 秒。需要 GameTest 1.2.6。',
          )}
        >
          <ui.Input
            size="sm"
            className="ue:w-full"
            inputMode="decimal"
            placeholder={t('1（默认）')}
            value={gap}
            onChange={(e: { target: { value: string } }) => setGap(e.target.value)}
          />
        </SettingRow>
        <SettingRow
          title={t('点击方式')}
          desc={t('回放时怎么点按钮')}
          hint={t(
            '不动鼠标：直接调按钮的点击（按下、点击、松开），找不到按钮时发虚拟鼠标事件，回放时可以照常用鼠标。真实鼠标：移光标按下松开，能测出遮挡和悬停，但回放时别动鼠标。单个步骤写 via 时以步骤为准。',
          )}
        >
          <ui.Select
            size="sm"
            className="ue:w-full"
            value={clickVia}
            onChange={(e: { target: { value: string } }) => setClickVia(e.target.value as 'code' | 'pointer')}
            options={[
              { value: 'code', label: t('不动鼠标（默认）') },
              { value: 'pointer', label: t('真实鼠标') },
            ]}
          />
        </SettingRow>
        <SettingRow
          title={t('随机种子')}
          desc={t('每次开跑前固定引擎的全局随机')}
          hint={t(
            '填整数时每次开跑前固定引擎的全局随机（蓝图 Random 节点、FMath::Rand）；游戏自己的随机流、Lua 的 math.random 管不到，用前置步骤里的 GM 固定。空着不固定。',
          )}
        >
          <ui.Input
            size="sm"
            className="ue:w-full"
            inputMode="numeric"
            placeholder={t('不固定')}
            value={seed}
            onChange={(e: { target: { value: string } }) => setSeed(e.target.value)}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup
        title={t('前置步骤')}
        desc={t('每次从场景文件跑都先跑这几步，让回放从同一个存档状态开始')}
        hint={t(
          '每次从场景文件跑都先跑这几步（写法和场景步骤一样），用来清引导、重置任务、发道具，让回放从同一个存档状态开始。场景写 "setup": false 的跳过；「从这一步开始运行」不跑。需要 GameTest 1.2.5。',
        )}
      >
        <div className="ue:py-3.5">
          <ui.Textarea
            rows={4}
            className="ue:font-mono"
            placeholder={SETUP_PLACEHOLDER}
            value={setup}
            onChange={(e: { target: { value: string } }) => setSetup(e.target.value)}
          />
        </div>
      </SettingGroup>

      <GtMoveSettings value={move} onChange={setMove} />

      <SettingGroup
        title={t('条目怎么认')}
        action={
          onOpenRules ? (
            <ui.Button size="sm" variant="ghost" onClick={onOpenRules}>
              <ListTree className="ue:h-3.5 ue:w-3.5" /> {t('管理规则')}
            </ui.Button>
          ) : undefined
        }
        hint={t(
          '录制时点到列表、格子里有规则的条目直接按规则认，不再暂停问。规则在 GameTest 页右上角的「条目规则」里按树形看、搜、改。',
        )}
      >
        <SettingRow
          title={t('{n} 条规则', { n: keyRules.length })}
          desc={t('录制时点到有规则的条目直接按规则认，不再暂停问')}
        />
      </SettingGroup>

      <SettingGroup
        title={t('阻挡界面')}
        action={<AddButton onClick={() => setRules([...rules, blank()])} />}
        hint={t(
          '公告、新手引导、活动弹窗这类不定时弹出的界面：跑测试时一出现就按规则处理掉，不让它挡住后面的步骤。正在等的那一步要点的就是它时不处理；每次处理都记在那一步的结果里。',
        )}
      >
        <SettingList count={rules.length}>
          {rules.map((r, i) => (
            <div
              key={i}
              className={cn(
                'ue:flex ue:flex-col ue:gap-2 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:p-2.5',
                r.enabled === false && 'ue:opacity-60',
              )}
            >
              <div className="ue:flex ue:items-center ue:gap-2">
                <SuggestInput
                  className="ue:min-w-0 ue:flex-1"
                  inputClassName="ue:font-mono"
                  placeholder={t('WBP 类名或资产路径，例如 WBP_Notice')}
                  value={r.widget}
                  onChange={(v) => patch(i, { widget: v })}
                  suggest={suggestWidgets}
                  status={indexStatus}
                  empty={t('索引里没找到控件蓝图，可以直接填类名或资产路径')}
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
        </SettingList>
      </SettingGroup>
    </>
  )
  const foot = (
    <>
      {error && <ErrorText>{error}</ErrorText>}
      {reply && (
        <p className="ue:text-footnote ue:text-subtle">
          {t('存在 {p}（跟着场景进版本管理，全组共用）', { p: reply.path })}
        </p>
      )}
    </>
  )
  if (!onClose)
    return (
      <>
        {sections}
        {/* 保存条贴在滚动区底部：表单很长，改了上面的项不用滚到底才能保存 */}
        <div className="ue:sticky ue:bottom-0 ue:z-10 ue:mt-4 ue:flex ue:flex-wrap ue:items-center ue:gap-3 ue:border-t ue:border-line ue:bg-bg ue:py-2.5">
          <div className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col ue:gap-1">{foot}</div>
          <ui.Button size="sm" disabled={!reply || saving} onClick={() => void save()}>
            {t('保存运行设置')}
          </ui.Button>
        </div>
      </>
    )
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
      <div className="ue:-mt-4 ue:flex ue:flex-col ue:gap-3 ue:text-body">
        {sections}
        {foot}
      </div>
    </ui.Modal>
  )
}
