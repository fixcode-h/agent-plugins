import {
  ArrowUpRight,
  Blocks,
  ChevronDown,
  CircleArrowUp,
  Download,
  FileCode2,
  FlaskConical,
  GitBranch,
  Hammer,
  Link,
  Loader2,
  Settings2,
  Trash2,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import type { Job } from '../../../../server/types.ts'
import { h, t } from '../../../host.ts'
import { openMenu } from '../../../menu.tsx'
import type { InstallMode, PluginActions } from '../Plugins.tsx'
import { cardState, isBroken, isStale, type PluginView } from './model.ts'
import { PluginCard } from './PluginCard.tsx'
import { isSettingsPlugin } from './PluginSettings.tsx'

/**
 * UE 插件页的卡片区：标题行（全部 / 已装 / 可装）+ 卡片网格（宽屏 3 列）。
 * 每张卡底栏的主按钮跟着状态变：安装、升级到 x、编译；「⋯」里放换安装方式、卸载（被依赖时置灰并说先卸谁）。
 * 底栏右边的「设置」打开这个插件自己的设置页（plugins/PluginSettings.tsx）：没装的也给，更新源这类装之前就要配。
 */
const ICONS: Record<string, LucideIcon> = { UELink: Link, AssetForge: FileCode2, GameTest: FlaskConical }
type Filter = 'all' | 'installed' | 'available'

export function CardsSection({
  link,
  exts,
  job,
  engine,
  vcs,
  actions,
}: {
  link: PluginView
  exts: PluginView[]
  job?: Job
  engine?: string
  /** 项目有版本管理（git / p4）：给「加入版本管理」 */
  vcs: boolean
  actions: PluginActions
}) {
  const { ui } = h()
  const [filter, setFilter] = useState<Filter>('all')
  const all = [link, ...exts]
  const shown = all.filter((v) =>
    filter === 'installed' ? !!v.installed : filter === 'available' ? !v.installed : true,
  )
  const n = { all: all.length, installed: all.filter((v) => v.installed).length }
  const jobBusy = job?.status === 'running'
  const busy = !!actions.busy || jobBusy

  const modeMenu = (e: MouseEvent, v: PluginView, verb: string) =>
    openMenu(e, [
      { label: t('{verb}（只在本机）', { verb }), onClick: () => actions.install(v, 'local' as InstallMode) },
      { label: t('{verb}并加入版本管理', { verb }), icon: GitBranch, onClick: () => actions.install(v, 'vcs') },
    ])

  const footer = (v: PluginView) => {
    const verb = v.installed ? t('升级') : t('安装')
    const blocked = !!v.offer?.blockers.length
    const working = actions.busy === `install-${v.name}`
    const main =
      v.offer && (!v.installed || v.upgrade) ? (
        <>
          <ui.Button size="sm" disabled={busy || blocked} onClick={() => actions.install(v)}>
            {working ? (
              <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />
            ) : v.installed ? (
              <CircleArrowUp className="ue:h-3.5 ue:w-3.5" />
            ) : (
              <Download className="ue:h-3.5 ue:w-3.5" />
            )}
            {v.installed ? t('升级到 {v}', { v: v.offer.version }) : t('安装')}
          </ui.Button>
          {vcs && !v.installed && (
            <ui.IconButton
              icon={ChevronDown}
              size="sm"
              label={t('选安装方式')}
              disabled={busy || blocked}
              onClick={(e: MouseEvent) => modeMenu(e, v, verb)}
            />
          )}
        </>
      ) : isBroken(v) ? (
        // 目录不全（缺模块的 Build.cs）：版本号没变也要能重新装一遍，否则编译一直报找不到模块
        <ui.Button size="sm" disabled={busy || blocked} onClick={() => actions.install(v)}>
          {working ? (
            <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />
          ) : (
            <Wrench className="ue:h-3.5 ue:w-3.5" />
          )}
          {t('重新安装')}
        </ui.Button>
      ) : null
    return (
      <>
        {main}
        {v.installed && (isStale(v) || v.base) && (
          <ui.Button size="sm" variant="secondary" disabled={busy} onClick={actions.build}>
            <Hammer className="ue:h-3.5 ue:w-3.5" /> {t('编译')}
          </ui.Button>
        )}
        {v.installed && v.known && (
          <ui.Button size="sm" variant="secondary" onClick={() => actions.open(v)}>
            <ArrowUpRight className="ue:h-3.5 ue:w-3.5" /> {t('打开')}
          </ui.Button>
        )}
      </>
    )
  }

  const more = (v: PluginView) => (e: MouseEvent) => {
    const otherMode = v.installed?.mode === 'vcs' ? 'local' : 'vcs'
    openMenu(e, [
      v.installed &&
        vcs &&
        v.offer &&
        v.upgrade && {
          label: otherMode === 'vcs' ? t('升级并加入版本管理') : t('升级（只在本机）'),
          icon: GitBranch,
          disabled: busy,
          onClick: () => actions.install(v, otherMode),
        },
      v.installed && {
        label: t('卸载'),
        icon: Trash2,
        danger: true,
        disabled: busy || v.requiredBy.length > 0,
        hint: v.requiredBy.length ? t('先卸 {names}', { names: v.requiredBy.join('、') }) : undefined,
        onClick: () => actions.uninstall(v),
      },
    ])
  }

  return (
    <>
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-x-2 ue:gap-y-1 ue:bg-card ue:px-4 ue:py-2.5">
        <span className="ue:text-heading ue:font-medium ue:text-fg">{t('插件')}</span>
        <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-footnote ue:text-subtle">
          {t('UELink 是基础，扩展挂在它上面；没装的也列在这里')}
        </span>
        <ui.Segmented
          size="sm"
          label={t('筛选插件')}
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all' as const, label: t('全部 {n}', { n: n.all }) },
            { id: 'installed' as const, label: t('已装 {n}', { n: n.installed }) },
            { id: 'available' as const, label: t('可装 {n}', { n: n.all - n.installed }) },
          ]}
        />
      </div>
      {/* 按内容区宽度分栏（容器查询）：UE 页左边还有分区栏，按窗口宽度算会在 1440 宽时只放得下两列 */}
      <div className="ue:@container">
        <div className="ue:grid ue:gap-px ue:bg-line ue:@2xl:grid-cols-2 ue:@5xl:grid-cols-3">
          {shown.map((v) => {
            const st = cardState(v, job)
            // 升级被拦住时也列原因（以前只在没装时列，升级按钮灰着不说为什么）
            const blockers = !v.installed || v.upgrade ? (v.offer?.blockers ?? []) : []
            const offering = !!v.offer && (!v.installed || v.upgrade)
            return (
              <PluginCard
                key={v.name}
                view={v}
                icon={ICONS[v.name] ?? Blocks}
                state={st}
                engine={engine}
                linkVersion={link.installed?.version}
                footer={footer(v)}
                aside={
                  <>
                    {v.offer?.notes && (
                      <ui.Button size="sm" variant="ghost" onClick={() => actions.notes(v)}>
                        {t('更新说明')}
                      </ui.Button>
                    )}
                    {isSettingsPlugin(v.name) && (
                      <ui.Button size="sm" variant="ghost" onClick={() => actions.settings(v)}>
                        <Settings2 className="ue:h-3.5 ue:w-3.5" /> {t('设置')}
                      </ui.Button>
                    )}
                  </>
                }
                onMore={v.installed ? more(v) : undefined}
                extra={
                  blockers.length > 0 ? (
                    <ul className="ue:list-disc ue:px-4 ue:pb-2.5 ue:pl-8 ue:text-footnote ue:text-danger">
                      {blockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  ) : st.key === 'broken' ? (
                    <p className="ue:px-4 ue:pb-2.5 ue:text-footnote ue:text-danger">
                      {t('缺模块 {mods} 的源码（Build.cs），编译会报找不到模块定义：点「重新安装」', {
                        mods: v.installed!.missing!.join('、'),
                      })}
                    </p>
                  ) : st.key === 'running' ? (
                    <p className="ue:px-4 ue:pb-2.5 ue:text-footnote ue:text-run">{t('正在升级，输出在页面最下面')}</p>
                  ) : offering && v.withUELink ? (
                    <p className="ue:px-4 ue:pb-2.5 ue:text-footnote ue:text-warning">
                      {t('要 UELink {need}：会先把 UELink 升到 {v} 再装', {
                        need: (v.info?.requires?.UELink ?? '').replace(/^>=\s*/, '≥ '),
                        v: link.offer?.version ?? '',
                      })}
                    </p>
                  ) : undefined
                }
              />
            )
          })}
          {/* 单数张时补一块空的，免得网格最后一格露出分隔线的底色 */}
          {shown.length % 2 === 1 && <div className="ue:hidden ue:bg-card ue:@2xl:block ue:@5xl:hidden" />}
          {shown.length % 3 !== 0 &&
            Array.from({ length: 3 - (shown.length % 3) }, (_, i) => (
              <div key={i} className="ue:hidden ue:bg-card ue:@5xl:block" />
            ))}
        </div>
      </div>
    </>
  )
}
