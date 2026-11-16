import { Blocks, MousePointerClick } from 'lucide-react'
import type { ExtensionStatus } from '../../../server/uekit/catalog.ts'
import { useUe } from '../../ctx.tsx'
import { t } from '../../host.ts'
import { Badge, Card, LinkBtn } from '../../ui.tsx'
import type { Upgrade } from './ext-data.ts'

/**
 * 概览右栏「扩展」：UELink 和项目里装了的 UEKit 扩展各一行 —— 版本、有没有加载进开着的 UE、能不能升级。
 * 点「UE 插件」去装卸升级
 */
export function Extensions({ exts, upgrades }: { exts?: ExtensionStatus[]; upgrades: Upgrade[] }) {
  const { state, go } = useUe()
  const editorUp = (state?.instances ?? []).some((i) => i.kind !== 'background' && i.online)
  const up = (name: string) => upgrades.find((u) => u.name === name)
  const rows = [
    {
      name: 'UELink',
      version: state?.bridge,
      note: state?.bridge ? (editorUp ? t('已连接') : t('UE 没在运行')) : t('没装：到「UE 插件」安装'),
    },
    ...(exts ?? [])
      .filter((x) => x.installed)
      .map((x) => ({
        name: x.name,
        version: x.installed!.version,
        note:
          x.loaded && x.loaded !== x.installed!.version
            ? t('UE 里还是 {v}，重新编译后生效', { v: x.loaded })
            : x.loaded
              ? t('已加载')
              : editorUp
                ? t('开着的 UE 里没加载：重新编译项目')
                : t('已安装'),
      })),
  ]
  return (
    <Card
      title={
        <>
          <Blocks className="ue:h-4 ue:w-4" /> {t('扩展')}
        </>
      }
      aside={<LinkBtn onClick={() => go('plugins')}>{t('UE 插件')}</LinkBtn>}
    >
      <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line">
        {rows.map((r) => {
          const u = up(r.name)
          return (
            <li key={r.name} className="ue:flex ue:min-w-0 ue:items-center ue:gap-2.5 ue:px-4 ue:py-2.5">
              <span className="ue:w-24 ue:shrink-0 ue:truncate ue:font-mono ue:text-body ue:text-fg">{r.name}</span>
              {r.version && <Badge>{r.version}</Badge>}
              <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-footnote ue:text-subtle">{r.note}</span>
              {u && <Badge tone="accent">{t('{v} 可升级', { v: u.to })}</Badge>}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/**
 * 概览右栏「编辑器里选中」的位置：要 UELink 2.4 的 editor.selection（另一批做，接上后在这里显示关卡里选中的 Actor、
 * 内容浏览器选中的资源和跟随开关）。现在编辑器开着时说明一句，没开不占地方
 */
export function SelectionSlot() {
  const { state } = useUe()
  const editor = (state?.instances ?? []).some((i) => i.kind === 'editor' && i.online)
  if (!editor) return null
  return (
    <Card
      title={
        <>
          <MousePointerClick className="ue:h-4 ue:w-4" /> {t('编辑器里选中')}
        </>
      }
    >
      <p className="ue:px-4 ue:py-3 ue:text-footnote ue:text-subtle">
        {t('UELink 2.4 起，编辑器里选中的 Actor 和资源会显示在这里，也会告诉 Agent')}
      </p>
    </Card>
  )
}
