import { Crosshair, Footprints, GitBranch, Hourglass, LocateFixed, MapPin, Square, X } from 'lucide-react'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { segmentSupported } from './gt-record-segment.ts'

/**
 * 录制条上的快捷动作（GameTest 1.3.0 的 gt.record.move）：和录制时悬浮的工具栏小窗口、Alt+数字同一个入口。
 * 录移动时其他操作都不录，所以这里一直显示「正在录移动 · 已走多少米」，让人知道现在点什么都不会进场景。
 */
export interface RecordQuick {
  /** 录制快捷键开着没有（运行配置 move.hotkeys，默认开） */
  hotkeys?: boolean
  /** 下一次点击录成断言（或 pickKind 说的那种） */
  pickArmed?: boolean
  /** 下一次点到的控件录成什么（GameTest 1.10.0）：断言、等到、按状态分支 */
  pickKind?: 'assert' | 'wait' | 'branch'
  /** 工具栏上那行提示（录移动自动结束、作废的原因），几秒后自己消失 */
  notice?: string
  moving?: { meters?: number; seconds?: number; points?: number }
}

type Phase = 'toggle' | 'cancel' | 'here' | 'near' | 'pick' | 'wait' | 'branch'

/** 按钮后面的快捷键提示：关了快捷键就不显示 */
function Key({ k, on }: { k: string; on: boolean }) {
  return on ? <span className="ue:ml-1 ue:text-caption ue:text-subtle">Alt+{k}</span> : null
}

export function GtRecordQuick({ status, gtVersion }: { status: RecordQuick; gtVersion?: string }) {
  const { project } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const keys = status.hotkeys !== false
  const moving = status.moving
  // 旧版 GameTest 只有 pickArmed（只会是断言）
  const armed = status.pickArmed ? (status.pickKind ?? 'assert') : undefined
  const quick = (phase: Phase) =>
    run(`move-${phase}`, async () => {
      await op(project.id, 'gt.record.move', { phase })
    })

  if (moving)
    return (
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:rounded-md ue:bg-run/10 ue:px-2.5 ue:py-1.5">
        <Footprints className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-run" />
        <span className="ue:text-footnote ue:text-fg ue:tabular-nums">
          {t('正在录移动 · 已走 {m} 米 · {s} 秒', {
            m: (moving.meters ?? 0).toFixed(1),
            s: Math.round(moving.seconds ?? 0),
          })}
        </span>
        <span className="ue:text-footnote ue:text-subtle">{t('其他操作暂不记录，点界面会自动结束')}</span>
        <span className="ue:flex-1" />
        <ui.Button size="sm" variant="ghost" disabled={!!busy} onClick={() => quick('cancel')}>
          <X className="ue:h-3.5 ue:w-3.5" /> {t('放弃这段')}
          <Key k="0" on={keys} />
        </ui.Button>
        <ui.Button size="sm" variant="primary" disabled={!!busy} onClick={() => quick('toggle')}>
          <Square className="ue:h-3.5 ue:w-3.5" /> {t('结束移动')}
          <Key k="1" on={keys} />
        </ui.Button>
      </div>
    )

  return (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
      <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={() => quick('toggle')}>
        <Footprints className="ue:h-3.5 ue:w-3.5" /> {t('录移动')}
        <Key k="1" on={keys} />
      </ui.Button>
      <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={() => quick('here')}>
        <MapPin className="ue:h-3.5 ue:w-3.5" /> {t('记下位置')}
        <Key k="2" on={keys} />
      </ui.Button>
      <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={() => quick('near')}>
        <LocateFixed className="ue:h-3.5 ue:w-3.5" /> {t('在这附近')}
        <Key k="3" on={keys} />
      </ui.Button>
      <ui.Button
        size="sm"
        variant={armed === 'assert' ? 'primary' : 'secondary'}
        disabled={!!busy}
        onClick={() => quick('pick')}
      >
        <Crosshair className="ue:h-3.5 ue:w-3.5" /> {armed === 'assert' ? t('点一个控件…') : t('断言')}
        <Key k="4" on={keys} />
      </ui.Button>
      {segmentSupported(gtVersion) && (
        <>
          <ui.Button
            size="sm"
            variant={armed === 'wait' ? 'primary' : 'secondary'}
            disabled={!!busy}
            title={t('再点一个控件，录成「等到它能点 / 出现」')}
            onClick={() => quick('wait')}
          >
            <Hourglass className="ue:h-3.5 ue:w-3.5" /> {armed === 'wait' ? t('点一个控件…') : t('等到')}
            <Key k="6" on={keys} />
          </ui.Button>
          <ui.Button
            size="sm"
            variant={armed === 'branch' ? 'primary' : 'secondary'}
            disabled={!!busy}
            title={t('再点一个控件，录成空的按状态分支，各条路在编辑页里填')}
            onClick={() => quick('branch')}
          >
            <GitBranch className="ue:h-3.5 ue:w-3.5" /> {armed === 'branch' ? t('点一个控件…') : t('分支')}
            <Key k="7" on={keys} />
          </ui.Button>
        </>
      )}
      {status.notice && <span className="ue:text-footnote ue:text-muted">{status.notice}</span>}
    </div>
  )
}
