import { ListTree } from 'lucide-react'
import { useEffect, useState } from 'react'
import { op } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { SettingGroup, SettingRow, useSettingsPage } from '../../SettingRows.tsx'
import { ErrorText } from '../../ui.tsx'
import type { GtGuard } from '../../../shared/gt-script/index.ts'
import { blockersToGuards, guardsSupported, tidyGuards, type BlockerRule } from './gt-guards/model.ts'
import { GtGuardsGroup } from './gt-guards/GtGuardsGroup.tsx'
import { GtBlockersGroup } from './GtBlockersGroup.tsx'
import { type GtMoveConfig, GtMoveSettings, tidyMove } from './GtMoveSettings.tsx'
import { type GtSkipConfig, GtSkipSettings, readSkip, tidySkip } from './GtSkipSettings.tsx'
import { tidyKeyRules, type GtKeyRule } from './GtKeyRules.tsx'
import { pieWindowSupported, refSupported, REF_MIN_VERSION } from './gt-ref/gate.tsx'
import { REF_KEYS, RefSettings, tidyRefConfig } from './gt-ref/RefSettings.tsx'
import type { RefConfig } from './gt-ref/rules-io.ts'
import { parseSeed, parseSetup, SETUP_PLACEHOLDER, setupText } from './gt-setup.ts'

/**
 * GameTest 的项目运行配置（场景根的 _settings.json，GameTest 1.2.0-beta.6 的 gt.config）：
 * UI 等待上限、阻挡界面规则。跟着场景进版本管理、全组共用，所以存在 UE 那边的场景根里，不存面板设置。
 */
export type GtBlockerRule = BlockerRule

interface GtRunConfig {
  uiWaitTimeoutMs?: number
  /** 相邻两个 UI 操作之间至少隔多久（GameTest 1.2.6，毫秒）；没写按 1000 */
  uiStepGapMs?: number
  /** click 没写 via 时的点击方式（GameTest 1.2.0-beta.7）：code 不动鼠标（默认），pointer 真实鼠标 */
  clickVia?: 'code' | 'pointer'
  /** pie.start 没写 window 时开在哪（GameTest 2.5.0）：viewport 选中的视口（默认），new 独立窗口 */
  pieWindow?: 'viewport' | 'new'
  /** GameTest 1.9.0 以前：阻挡界面 */
  blockers?: GtBlockerRule[]
  /** GameTest 1.9.0 起：全局守护（取代 blockers） */
  guards?: GtGuard[]
  /** 前置步骤（GameTest 1.2.5）：从场景文件跑时先跑，放清引导、重置存档之类的 GM */
  setup?: Record<string, unknown>[]
  /** 开跑前固定引擎全局随机（GameTest 1.2.5） */
  randomSeed?: number
  /** move 步骤和录制快捷键（GameTest 1.3.0） */
  move?: GtMoveConfig
  /** 条目怎么认的规则（GameTest 1.4.0） */
  itemKeys?: GtKeyRule[]
  /** 已达成就跳过（GameTest 1.7.0）：false 全部照做，对象只留改过的项 */
  skipIf?: false | GtSkipConfig
  /** 步骤能调 Lua 函数（GameTest 1.9，默认 true） */
  allowLuaInvoke?: boolean
  /** 条件、表达式能调 Lua 函数（GameTest 1.9，默认 false） */
  allowLuaInCond?: boolean
}

interface ConfigReply {
  path: string
  exists: boolean
  config: GtRunConfig
  settingsUiWaitTimeoutMs: number
}

/** 运行设置在分页设置页里占的几页（GtMoveSettings 是 move、GtSkipSettings 是 skip）：保存栏只在这几页出现 */
export const GT_RUN_PAGES = ['playback', 'script', 'setup', 'move', 'skip', 'refs', 'guards'] as const

/** 这份表单自己管的字段：保存时以表单为准，其余字段从文件里现取原样写回 */
const FORM_KEYS = new Set([
  'uiWaitTimeoutMs',
  'uiStepGapMs',
  'clickVia',
  'pieWindow',
  'blockers',
  'guards',
  'setup',
  'randomSeed',
  'move',
  'skipIf',
  'itemKeys',
  'allowLuaInvoke',
  'allowLuaInCond',
  ...REF_KEYS,
])

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
  const { project, state } = useUe()
  const { ui } = h()
  const onRunPage = useSettingsPage(GT_RUN_PAGES)
  const [reply, setReply] = useState<ConfigReply>()
  const [wait, setWait] = useState('')
  const [gap, setGap] = useState('')
  const [clickVia, setClickVia] = useState<'code' | 'pointer'>('code')
  const [pieWindow, setPieWindow] = useState<'viewport' | 'new'>('viewport')
  const [rules, setRules] = useState<GtBlockerRule[]>([])
  const [setup, setSetup] = useState('')
  const [seed, setSeed] = useState('')
  const [move, setMove] = useState<GtMoveConfig>({})
  const [skip, setSkip] = useState<GtSkipConfig>({})
  const [keyRules, setKeyRules] = useState<GtKeyRule[]>([])
  const [luaInvoke, setLuaInvoke] = useState(true)
  const [luaInCond, setLuaInCond] = useState(false)
  // 对象与标识（GameTest 2.0）：identRules、closeRules、refDefaults、allowDestroy
  const [refCfg, setRefCfg] = useState<RefConfig>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [guards, setGuards] = useState<GtGuard[]>([])
  // 从阻挡界面改写过来的：保存时才写进文件（GameTest 读到旧文件也会自己改写，这里先给人看改写后的样子）
  const [migrated, setMigrated] = useState(false)
  const gtVersion = state?.extensions?.find((x) => x.name === 'GameTest')?.version
  const live = (state?.instances ?? []).some((i) => i.kind === 'editor' && i.online)
  const guardsOn = guardsSupported(gtVersion)
  const refOn = refSupported(gtVersion)

  useEffect(() => {
    op<ConfigReply>(project.id, 'gt.config')
      .then((r) => {
        setReply(r)
        setWait(r.config.uiWaitTimeoutMs === undefined ? '' : String(r.config.uiWaitTimeoutMs / 1000))
        setGap(r.config.uiStepGapMs === undefined ? '' : String(r.config.uiStepGapMs / 1000))
        setRules(r.config.blockers ?? [])
        const old = !r.config.guards && !!r.config.blockers?.length
        setGuards(r.config.guards ?? blockersToGuards(r.config.blockers ?? []))
        setMigrated(old)
        setClickVia(r.config.clickVia ?? 'code')
        setPieWindow(r.config.pieWindow === 'new' ? 'new' : 'viewport')
        setSetup(setupText(r.config.setup))
        setSeed(r.config.randomSeed === undefined ? '' : String(r.config.randomSeed))
        setMove(r.config.move ?? {})
        setSkip(readSkip(r.config.skipIf))
        setKeyRules(r.config.itemKeys ?? [])
        setLuaInvoke(r.config.allowLuaInvoke !== false)
        setLuaInCond(r.config.allowLuaInCond === true)
        const c = r.config as RefConfig
        setRefCfg({
          identRules: c.identRules,
          closeRules: c.closeRules,
          refDefaults: c.refDefaults,
          allowDestroy: c.allowDestroy,
        })
      })
      .catch((e: Error) => setError(e.message))
  }, [project.id])

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
        ...(pieWindow === 'new' ? { pieWindow } : {}),
        // 空行不存：点了「添加」没填的不该让整份配置保存失败
        // 新版存守护、不再写 blockers（GameTest 1.9.0 起再读到 blockers 会报错）；旧版照旧存阻挡界面
        ...(guardsOn
          ? { guards: tidyGuards(guards) }
          : { blockers: rules.filter((r) => r.widget.trim()).map((r) => ({ ...r, widget: r.widget.trim() })) }),
        ...(setupParsed.steps?.length ? { setup: setupParsed.steps } : {}),
        ...(seedParsed.seed === undefined ? {} : { randomSeed: seedParsed.seed }),
        ...(tidyMove(move) ? { move: tidyMove(move) } : {}),
        ...(tidySkip(skip) !== undefined ? { skipIf: tidySkip(skip) } : {}),
        // 默认值不写进文件
        ...(luaInvoke ? {} : { allowLuaInvoke: false }),
        ...(luaInCond ? { allowLuaInCond: true } : {}),
      }
      // 条目规则也在这份文件里、由规则面板和录制弹窗改：表单整份重写，保存前现取一遍最新的带上，不然就丢了
      const latest = (await op<ConfigReply>(project.id, 'gt.config')).config as GtRunConfig & Record<string, unknown>
      if (refOn) {
        // GameTest 2.0 起 itemKeys / objectKeys 并进 identRules（旧字段读到会报 settings_old，不再写回）
        // 「以后都按这个认」「这个类以后都这样关」也写这份文件：表单里没有的规则从最新文件里补上
        // 旧的 itemKeys / objectKeys 不迁移（旧格式不再支持），整份重写时不再带上
        const disk = latest as RefConfig
        const mine = tidyRefConfig(refCfg)
        const merged: RefConfig = {
          ...mine,
          identRules: [
            ...(mine.identRules ?? []),
            ...(disk.identRules ?? []).filter((x) => !(refCfg.identRules ?? []).some((y) => y.class === x.class)),
          ],
          closeRules: [
            ...(mine.closeRules ?? []),
            ...(disk.closeRules ?? []).filter((x) => !(refCfg.closeRules ?? []).some((y) => y.class === x.class)),
          ],
        }
        Object.assign(config, tidyRefConfig(merged))
      } else {
        const fresh = latest.itemKeys ?? keyRules
        if (tidyKeyRules(fresh).length) config.itemKeys = tidyKeyRules(fresh)
      }
      // 这份表单不管的字段（接口库文件夹 api、守护 guards、objectKeys 这些脚本化以后加的）原样带回去，整份重写时不丢
      for (const [k, v] of Object.entries(latest))
        // 旧版 GameTest（2.0 以前）不显示对象与标识页：文件里的 objectKeys、identRules 这些原样带回去
        if (
          (!FORM_KEYS.has(k) ||
            (k === 'guards' && !guardsOn) ||
            (!refOn && k !== 'itemKeys' && (REF_KEYS as readonly string[]).includes(k))) &&
          !(k in config)
        )
          (config as unknown as Record<string, unknown>)[k] = v
      await op(project.id, 'gt.config', { config })
      h().toast.success(t('已保存，下次运行生效'))
      onClose?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // 弹窗里不写「存在哪」（弹窗底下有一行），设置页里写在第一组的组名旁边
  const framed = !!onClose
  const where = t('这个项目 · 存在场景根的 _settings.json，全组共用')
  const sections = (
    <>
      <SettingGroup page="playback" title={t('回放')} aside={framed ? undefined : where}>
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
          title={t('PIE 开在')}
          desc={t('跑测试和 Agent 开 PIE 时游戏在哪运行')}
          hint={
            pieWindowSupported(gtVersion)
              ? t(
                  '选中的视口：和 UE Play 菜单勾「选中的视口」一样，在当前关卡视口里运行，不弹独立窗口。独立窗口：开一个单独的游戏窗口（分辨率按 pie.start 的 width、height）。步骤写 window 时以步骤为准；关卡视口看不见时自动改开独立窗口。',
                )
              : t('要 GameTest 2.5.0 才能选，旧版 PIE 总是开独立窗口：到「UE 插件」更新 GameTest 后重新编译。')
          }
        >
          <ui.Select
            size="sm"
            className="ue:w-full"
            value={pieWindow}
            disabled={!pieWindowSupported(gtVersion)}
            onChange={(e: { target: { value: string } }) => setPieWindow(e.target.value as 'viewport' | 'new')}
            options={[
              { value: 'viewport', label: t('选中的视口（默认）') },
              { value: 'new', label: t('独立窗口') },
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
        page="script"
        title={t('脚本')}
        desc={t('回放脚本里的调函数、条件和表达式能不能调 Lua')}
        hint={t('需要 GameTest 1.9。C++ 和蓝图的函数不受这两项影响。')}
      >
        <SettingRow
          title={t('步骤里可调 Lua 函数')}
          desc={t('「调函数」「调接口」的步骤能不能调 Lua 表上的函数')}
          hint={t('关掉后脚本里调 Lua 函数的步骤会直接失败并写明原因；C++、蓝图照常。')}
        >
          <ui.Select
            size="sm"
            className="ue:w-full"
            value={luaInvoke ? 'on' : 'off'}
            onChange={(e: { target: { value: string } }) => setLuaInvoke(e.target.value === 'on')}
            options={[
              { value: 'on', label: t('可以（默认）') },
              { value: 'off', label: t('不可以') },
            ]}
          />
        </SettingRow>
        <SettingRow
          title={t('条件里可调 Lua 函数')}
          desc={t('条件、表达式里的只读调用能不能调 Lua')}
          hint={t('条件在等待中每 0.2 秒算一次，Lua 函数有副作用时会被反复调用，所以默认关。')}
        >
          <ui.Select
            size="sm"
            className="ue:w-full"
            value={luaInCond ? 'on' : 'off'}
            onChange={(e: { target: { value: string } }) => setLuaInCond(e.target.value === 'on')}
            options={[
              { value: 'off', label: t('不可以（默认）') },
              { value: 'on', label: t('可以') },
            ]}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup
        page="setup"
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

      <GtSkipSettings value={skip} onChange={setSkip} />

      {refOn ? (
        <RefSettings value={refCfg} onChange={setRefCfg} />
      ) : (
        <SettingGroup
          page="refs"
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
            desc={t('GameTest {m} 起换成「按类记住的标识」，升级 GameTest 后这里换成对象与标识', {
              m: REF_MIN_VERSION,
            })}
          />
        </SettingGroup>
      )}

      {guardsOn ? (
        <GtGuardsGroup
          value={guards}
          onChange={setGuards}
          migrated={migrated}
          project={project.id}
          live={live}
          root={reply?.path.replace(/[\\/][^\\/]*$/, '') ?? ''}
        />
      ) : (
        <GtBlockersGroup rules={rules} onChange={setRules} />
      )}
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
        {/* 保存条贴在滚动区底部，只在运行设置那几页出现；切到别的页时表单还挂着，没保存的改动不丢 */}
        {onRunPage && (
          <div className="ue:sticky ue:bottom-0 ue:z-10 ue:mt-4 ue:flex ue:flex-wrap ue:items-center ue:gap-3 ue:border-t ue:border-line ue:bg-bg ue:py-2.5">
            <div className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col ue:gap-1">{foot}</div>
            <ui.Button size="sm" disabled={!reply || saving} onClick={() => void save()}>
              {t('保存运行设置')}
            </ui.Button>
          </div>
        )}
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
