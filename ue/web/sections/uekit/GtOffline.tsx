import { Info } from 'lucide-react'
import { busyOf, busyWhat } from '../../busy/busy.tsx'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'

/**
 * GameTest 页在编辑器没连上时页顶的一条说明（用户 2026-11-16：没在运行也要能看，只是不能录制和运行）。
 * 「UE 没在运行 + 启动编辑器」已经由编辑页顶栏的连接状态胶囊（ConnPill，和 GM 页同一个）说了，这里不再重复一遍
 * （分析文档 U6）；只留胶囊管不到的两种：桥接插件没装（启动了也连不上）、编辑器正忙（再起一个会抢项目）
 */
export function GtOfflineBar() {
  const { state, go } = useUe()
  const { ui } = h()
  const busy = busyOf(state)[0]
  const noBridge = !!state && !state.bridge
  if (!busy && !noBridge) return null
  return (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2 ue:text-footnote">
      <Info className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
      <span className="ue:min-w-0 ue:flex-1 ue:text-subtle">
        {busy
          ? t('编辑器正忙（{what}）：场景、历史和上次的报告照常能看、能改；录制、运行、核对选择器等它回应后再用', {
              what: busyWhat(busy),
            })
          : t('项目里还没装桥接插件：场景照常能看、能改；录制、运行要先装好它')}
      </span>
      {!busy && (
        <ui.Button size="sm" variant="secondary" onClick={() => go('plugins')}>
          {t('先装桥接插件')}
        </ui.Button>
      )}
    </div>
  )
}
