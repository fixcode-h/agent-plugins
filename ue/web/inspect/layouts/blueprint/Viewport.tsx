import { Box, ExternalLink, MonitorOff } from 'lucide-react'
import { op, useAction } from '../../../api.ts'
import type { Comp } from '../../../CompTree.tsx'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { useLaunch } from '../../../launch.ts'
import { LaunchButton } from '../../../launch-progress/LaunchButton.tsx'
import { Card } from '../../../ui.tsx'
import { assetName } from '../common.tsx'

/**
 * 视口（效果图 A1 / A4 中间）：UE 侧的视口渲染（设计稿第 5 节 UELink asset.preview）还没有，
 * 这里不画假的 3D 画面，只说明为什么空着、能做什么：UE 连着时「在 UE 里打开」看真视口，没连上时给「启动编辑器」。
 * 选中的组件写在左上角（和 UE 视口里的选中提示对应），组件树、细节照常能用
 */
export function Viewport({ path, online, picked }: { path: string; online: boolean; picked?: Comp }) {
  const { project } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const launch = useLaunch()
  const open = () => void run('open', () => op(project.id, 'asset.open', { path }, { instance: 'editor' }))
  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={
        <>
          <Box className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
          {t('视口')}
          <span className="ue:truncate ue:text-footnote ue:font-normal ue:text-subtle">{assetName(path)}</span>
        </>
      }
      bodyClass="ue:relative ue:flex ue:min-h-0 ue:flex-col ue:items-center ue:justify-center ue:gap-3 ue:bg-panel ue:p-6 ue:text-center"
    >
      {picked && (
        <span className="ue:absolute ue:top-3 ue:left-3 ue:flex ue:max-w-[70%] ue:items-center ue:gap-1.5 ue:rounded-md ue:border ue:border-line ue:bg-card ue:px-2 ue:py-1 ue:text-caption ue:text-subtle">
          {t('已选')}
          <span className="ue:truncate ue:font-medium ue:text-fg">{picked.name}</span>
          <span className="ue:truncate">{picked.class}</span>
        </span>
      )}
      <MonitorOff className="ue:h-8 ue:w-8 ue:text-subtle" />
      <div className="ue:text-body ue:font-medium ue:text-fg">{t('视口要 UE 实时渲染')}</div>
      <p className="ue:max-w-md ue:text-footnote ue:text-subtle">
        {online
          ? t(
              'UELink 还没有视口渲染接口（asset.preview），网页里先不画预览。组件树、我的蓝图、图表和细节照常能看能改；要看 3D 画面点「在 UE 里打开」。',
            )
          : t('UE 编辑器没开（或项目没装 UELink）：组件树、变量、图表和细节都要 UE 导出，连上后自动刷新。')}
      </p>
      {online ? (
        <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={open}>
          <ExternalLink className="ue:h-3.5 ue:w-3.5" /> {t('在 UE 里打开')}
        </ui.Button>
      ) : (
        <LaunchButton
          size="sm"
          progress={launch.progress}
          disabled={launch.busy}
          onClick={() => void launch.start(false)}
        >
          {t('启动编辑器')}
        </LaunchButton>
      )}
    </Card>
  )
}
