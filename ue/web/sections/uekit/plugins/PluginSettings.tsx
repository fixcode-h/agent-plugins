import {
  ArrowLeft,
  Camera,
  CloudDownload,
  FolderOpen,
  Footprints,
  Hammer,
  KeyRound,
  ListStart,
  MonitorOff,
  Play,
  ScanText,
  Settings2,
  ShieldX,
  SkipForward,
} from 'lucide-react'
import { useState } from 'react'
import { pget, useLoad } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { OcrSettings } from '../../../OcrSettings.tsx'
import { SettingGroup, SettingRow, SettingsLayout, type SettingsNavSection } from '../../../SettingRows.tsx'
import { Badge, ErrorText, PageHead } from '../../../ui.tsx'
import { GtSettings } from '../GtSettings.tsx'

/**
 * UE 插件页里每个插件自己的设置页（卡片上的「设置」，地址 plugins/<插件名>）。
 * 用户 2026-11-17：「每个插件都增加自己专属的设置」——原来 GameTest 的运行设置在 GameTest 页的弹窗里，
 * 录制截图和 OCR 在面板设置 → 插件参数 → UE 里，UELink 的更新源也在那，找起来要翻好几处。这里按插件收拢：
 * - 面板参数（清单 settings）按分组挑出来用面板的表单画（host.ui.PluginParams），和设置页改的是同一份值；
 *   旧面板没有这个组件时给去设置页的按钮。
 * - 跟着项目走的（GameTest 的 _settings.json）用原来的表单（按节拆成几张卡片，和面板参数同一种两栏行）；UE 项目设置里的目录只读显示，不改 ini。
 */
export const SETTINGS_PLUGINS = ['UELink', 'AssetForge', 'GameTest'] as const
export type SettingsPlugin = (typeof SETTINGS_PLUGINS)[number]
export const isSettingsPlugin = (s: string): s is SettingsPlugin => (SETTINGS_PLUGINS as readonly string[]).includes(s)

interface PathEntry {
  path: string
  exists: boolean
  fromSetting: boolean
}
interface Paths {
  forgeRoot: PathEntry
  gtScenarioRoot: PathEntry
  gtOutputRoot: PathEntry
}

/** 面板参数里的几个分组：新面板直接画表单，旧面板给去设置页的入口 */
function PanelParams({ groups }: { groups: string[] }) {
  const { ui, hooks } = h()
  const nav = hooks.useNav()
  if (ui.PluginParams) return <ui.PluginParams groups={groups} />
  return (
    <div className="ue:flex ue:items-center ue:gap-3 ue:px-4 ue:py-3.5">
      <p className="ue:min-w-0 ue:flex-1 ue:text-body ue:text-subtle">
        {t('这几项在面板设置里改（升级面板后可以直接在这里改）')}
      </p>
      <ui.Button size="sm" variant="secondary" onClick={() => nav.openSettings('pparam:ue')}>
        <Settings2 className="ue:h-3.5 ue:w-3.5" /> {t('打开设置')}
      </ui.Button>
    </div>
  )
}

/** 只读的目录行：实际用的路径、是设置里填的还是按约定找的、在不在；怎么改写在问号里 */
function PathRow({ label, entry, where }: { label: string; entry?: PathEntry; where: string }) {
  return (
    <SettingRow
      stack
      hint={where}
      title={
        <>
          {label}
          {entry && (
            <Badge tone={entry.fromSetting ? 'run' : undefined}>
              {entry.fromSetting ? t('项目设置里填的') : t('按约定找的')}
            </Badge>
          )}
          {entry && !entry.exists && <Badge tone="warn">{t('还没建')}</Badge>}
        </>
      }
      desc={
        <span className="ue:inline-flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:font-mono ue:text-footnote ue:break-all ue:text-muted">
          <FolderOpen className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
          {entry?.path ?? t('读取中…')}
        </span>
      }
    />
  )
}

/** 左边菜单：分节照面板设置窗口的侧栏，一项一页（id 对应各组 SettingGroup 的 page） */
function settingsNav(): Record<SettingsPlugin, SettingsNavSection[]> {
  return {
    UELink: [
      {
        title: t('所有项目共用'),
        items: [
          { id: 'source', label: t('更新源'), icon: CloudDownload },
          { id: 'offline', label: t('编辑器没开时'), icon: MonitorOff },
        ],
      },
      { title: t('这个项目'), items: [{ id: 'build', label: t('编译'), icon: Hammer }] },
    ],
    AssetForge: [{ title: t('这个项目'), items: [{ id: 'paths', label: t('目录'), icon: FolderOpen }] }],
    GameTest: [
      {
        title: t('运行设置 · 这个项目'),
        items: [
          { id: 'playback', label: t('回放'), icon: Play },
          { id: 'setup', label: t('前置步骤'), icon: ListStart },
          { id: 'move', label: t('移动'), icon: Footprints },
          { id: 'skip', label: t('已达成就跳过'), icon: SkipForward },
          { id: 'keys', label: t('条目怎么认'), icon: KeyRound },
          { id: 'blockers', label: t('阻挡界面'), icon: ShieldX },
        ],
      },
      {
        title: t('录制 · 所有项目共用'),
        items: [
          { id: 'shots', label: t('录制截图'), icon: Camera },
          { id: 'ocr', label: t('OCR 认字'), icon: ScanText },
        ],
      },
      { title: t('其他'), items: [{ id: 'paths', label: t('目录'), icon: FolderOpen }] },
    ],
  }
}

export function PluginSettings({ name }: { name: SettingsPlugin }) {
  const { project, go } = useUe()
  const { ui } = h()
  const paths = useLoad(() => pget<Paths>(project.id, 'ext/paths'), [project.id])
  const p = paths.data
  const nav = settingsNav()
  // 每个插件记自己停在哪一页；切插件时回到它记的那页（没有就第一页）
  const [pages, setPages] = useState<Partial<Record<SettingsPlugin, string>>>({})
  const cur = pages[name] ?? nav[name][0].items[0].id
  const setPage = (id: string) => setPages((m) => ({ ...m, [name]: id }))
  const desc: Record<SettingsPlugin, string> = {
    UELink: t('更新源、编辑器没开时怎么读资源；引擎目录和编译命令在「权限与设置」'),
    AssetForge: t('配置放在哪；模板放在配置根的 _templates/ 下'),
    GameTest: t('回放怎么跑、录制截图和认字、场景和结果放在哪'),
  }
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title={t('{name} 设置', { name })} desc={desc[name]}>
        <ui.Button size="sm" variant="ghost" onClick={() => go('plugins')}>
          <ArrowLeft className="ue:h-3.5 ue:w-3.5" /> {t('返回 UE 插件')}
        </ui.Button>
        <ui.Segmented
          size="sm"
          label={t('插件')}
          value={name}
          onChange={(v: string) => go('plugins', v)}
          options={SETTINGS_PLUGINS.map((id) => ({ id, label: id }))}
        />
      </PageHead>
      <SettingsLayout nav={nav[name]} current={cur} onPick={setPage}>
        {paths.error && (
          <div className="ue:pt-4">
            <ErrorText>{paths.error}</ErrorText>
          </div>
        )}
        {name === 'UELink' && (
          <>
            <SettingGroup page="source" title={t('更新源')} aside={t('所有项目共用')} flush>
              <PanelParams groups={['UELink']} />
            </SettingGroup>
            <SettingGroup page="offline" title={t('编辑器没开时')} aside={t('所有项目共用')} flush>
              <PanelParams groups={['离线读取']} />
            </SettingGroup>
            <SettingGroup page="build" title={t('编译')}>
              <SettingRow title={t('引擎目录和编译命令')} desc={t('整个项目共用，UELink 卡片上的「编译」也按它们编')}>
                <div className="ue:flex ue:justify-end">
                  <ui.Button size="sm" variant="secondary" onClick={() => go('bridge')}>
                    {t('去权限与设置')}
                  </ui.Button>
                </div>
              </SettingRow>
            </SettingGroup>
          </>
        )}
        {name === 'AssetForge' && (
          <SettingGroup page="paths" title={t('目录')} aside={t('这个项目')}>
            <PathRow
              label={t('配置根')}
              entry={p?.forgeRoot}
              where={t(
                '在 UE 的「项目设置 → 插件 → Asset Forge → 配置根目录」改（写进 Config/DefaultEditor.ini）；空着时项目外层有 ProjectDoc/docs 用 ProjectDoc/docs/AssetForge，否则 docs/AssetForge',
              )}
            />
          </SettingGroup>
        )}
        {name === 'GameTest' && (
          <>
            {/* 运行设置占左边菜单的前六页，一直挂着（换页不丢没保存的改动），只画当前那一组 */}
            <GtSettings />
            <SettingGroup page="shots" title={t('录制截图')} aside={t('所有项目共用')} flush>
              <PanelParams groups={['GameTest 录制']} />
            </SettingGroup>
            <SettingGroup page="ocr" title={t('OCR（认录制截图里的字）')} aside={t('所有项目共用')}>
              <OcrSettings bare />
            </SettingGroup>
            <SettingGroup page="paths" title={t('目录')} aside={t('这个项目')}>
              <PathRow
                label={t('场景根')}
                entry={p?.gtScenarioRoot}
                where={t(
                  '在 UE 的「项目设置 → 插件 → Game Test → 场景根目录」改（写进 Config/DefaultGame.ini）；空着时项目外层有 ProjectDoc/docs 用 ProjectDoc/docs/GameTest，否则 docs/GameTest',
                )}
              />
              <PathRow
                label={t('报告和截图')}
                entry={p?.gtOutputRoot}
                where={t('在 UE 的「项目设置 → 插件 → Game Test → 产物根目录」改，相对 Saved/；默认 Saved/GameTest')}
              />
            </SettingGroup>
          </>
        )}
      </SettingsLayout>
    </div>
  )
}
