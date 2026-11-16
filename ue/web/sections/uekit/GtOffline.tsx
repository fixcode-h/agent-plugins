import { Info } from 'lucide-react'
import { busyOf, busyWhat } from '../../busy/busy.tsx'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useLaunch } from '../../launch.ts'
import { LaunchButton } from '../../launch-progress/LaunchButton.tsx'

/**
 * GameTest 页在编辑器没连上时页顶的一条说明（用户 2026-11-16：没在运行也要能看，只是不能录制和运行）。
 * 场景、步骤、历史、上次的报告和失败证据都从磁盘读（服务端 uekit/gt-disk.ts），场景照样能改名、复制、转成控件步骤；
 * 录制、运行、批量、核对选择器要编辑器，按钮置灰，这里给直接启动的按钮。编辑器只是忙时不给启动（再起一个会抢项目）
 */
export function GtOfflineBar() {
  const { state, go } = useUe()
  const { ui } = h()
  const launch = useLaunch()
  const busy = busyOf(state)[0]
  return (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2 ue:text-footnote">
      <Info className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
      <span className="ue:min-w-0 ue:flex-1 ue:text-subtle">
        {busy
          ? t('编辑器正忙（{what}）：场景、历史和上次的报告照常能看、能改；录制、运行、核对选择器等它回应后再用', {
              what: busyWhat(busy),
            })
          : t('UE 没在运行：场景、历史和上次的报告照常能看、能改；录制、运行、核对选择器要先启动编辑器')}
      </span>
      {!busy &&
        (state && !state.bridge ? (
          <ui.Button size="sm" variant="secondary" onClick={() => go('plugins')}>
            {t('先装桥接插件')}
          </ui.Button>
        ) : (
          <LaunchButton
            size="sm"
            variant="secondary"
            progress={launch.progress}
            disabled={launch.busy}
            onClick={() => void launch.start(false)}
          >
            {t('启动编辑器')}
          </LaunchButton>
        ))}
    </div>
  )
}
