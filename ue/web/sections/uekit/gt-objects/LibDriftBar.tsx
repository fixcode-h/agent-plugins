import { Library } from 'lucide-react'
import { libDrift, syncFromLib, unlinkLib } from '../../../../shared/obj-lib/link.ts'
import type { GtScript } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { useObjLib } from './use-obj-lib.ts'

/**
 * 打开脚本时和对象库比（第三期 3.3）：脚本里从对象库拷来的对象，库里后来改了（或删了），顶上一条提示，
 * 「同步」按库里的更新脚本，「保留脚本里的」断开来源、以后不再提示。只是改脚本（进撤销栈），存不存由用户定
 */
export function LibDriftBar({
  project,
  doc,
  apply,
  readOnly,
}: {
  project: string
  doc: GtScript | undefined
  apply: (d: GtScript) => void
  readOnly?: boolean
}) {
  const { ui } = h()
  const lib = useObjLib(project)
  if (!doc || !lib.data || readOnly) return null
  const drift = libDrift(doc, lib.data.objects)
  if (!drift.length) return null
  const names = drift.map((d) => d.name)
  const gone = drift.filter((d) => d.gone)
  return (
    <div className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:bg-accent-soft ue:px-4 ue:py-1.5 ue:text-footnote ue:text-fg">
      <Library className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent" />
      <span className="ue:min-w-0 ue:flex-1 ue:truncate" title={drift.map((d) => `${d.name} ← ${d.path}`).join('\n')}>
        {gone.length === drift.length
          ? t('对象库里删掉了：{n}（脚本里还留着规则）', { n: names.join('、') })
          : t('对象库里改过：{n}，脚本里还是拷来时的规则', { n: names.join('、') })}
      </span>
      {gone.length < drift.length && (
        <ui.Button size="sm" variant="secondary" onClick={() => apply(syncFromLib(doc, lib.data!.objects, names))}>
          {t('同步')}
        </ui.Button>
      )}
      <ui.Button size="sm" variant="ghost" onClick={() => apply(unlinkLib(doc, names))}>
        {t('保留脚本里的')}
      </ui.Button>
    </div>
  )
}
