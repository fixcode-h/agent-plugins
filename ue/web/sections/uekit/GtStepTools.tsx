import { useEffect, useState } from 'react'
import { ExternalLink, FastForward, Loader2, LocateFixed, Pencil, Play } from 'lucide-react'
import { op } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useOpenInEditor } from '../assets/asset-menu.ts'
import { hintOf } from './gt-steps.ts'
import { CheckMark, type GtResolveItem, type StepRow } from './GtStepDetail.tsx'

export interface StepToolProps {
  /** 只跑这一步 / 从这一步跑到最后：父组件拿场景文件里的步骤去 gt.run（编辑器没连上、正在跑时不给） */
  onRunOne?: () => void
  onRunFrom?: () => void
  /** 改这一步的 JSON（弹窗，走 ext/gt/file replace） */
  onEdit?: () => void
  /** 正在跑：这时 gt.step 会被拒，改场景文件也不让（结果会对不上） */
  running?: boolean
}

/**
 * 步骤详情头部的一排按钮：只跑这一步、从这一步开始跑、在游戏里框出控件、在 UE 里打开界面资源（WBP）、编辑这一步。
 * 「框出来」用现成的两个操作，不改 C++：gt.resolve 拿此刻能不能找到、是什么类；再 gt.step 跑一次
 * assert exists（只读），GameTest 执行器碰过的控件会在游戏窗口里框 2.5 秒
 */
export function GtStepTools({ row, onRunOne, onRunFrom, onEdit, running }: StepToolProps & { row: StepRow }) {
  const { project, state } = useUe()
  const { ui } = h()
  const editor = useOpenInEditor()
  const online = (state?.instances ?? []).some((i) => i.kind === 'editor' && i.online)
  const target = typeof row.def?.target === 'string' ? row.def.target : row.res?.target
  const canLocate = !!target && !target.startsWith('@')
  const asset = hintOf(row.def)?.asset
  const [locating, setLocating] = useState(false)
  const [found, setFound] = useState<GtResolveItem>()
  // 换了一步，上一步的定位结果不再算数
  useEffect(() => setFound(undefined), [row.key, target])

  const locate = async () => {
    if (!target) return
    setLocating(true)
    try {
      const r = await op<{ results?: GtResolveItem[] }>(project.id, 'gt.resolve', { targets: [target] })
      const item = r.results?.[0] ?? { target, found: false, error: t('UE 没回结果') }
      setFound(item)
      // 找得到才去框：找不到时 assert 也只会失败，白白多一条运行记录
      if (item.found)
        await op(project.id, 'gt.step', {
          step: { action: 'assert', target, exists: true, note: '面板：在游戏里框出这一步的控件' },
        })
    } catch (e) {
      h().toast.error((e as Error).message)
    } finally {
      setLocating(false)
    }
  }

  const offlineWhy = t('要连着编辑器、开着 PIE')
  return (
    <>
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1.5 ue:pt-1">
        {onRunOne && (
          <ui.Button size="sm" variant="secondary" disabled={running} onClick={onRunOne}>
            <Play className="ue:h-3.5 ue:w-3.5" /> {t('只跑这一步')}
          </ui.Button>
        )}
        {onRunFrom && (
          <ui.Button size="sm" variant="secondary" disabled={running} onClick={onRunFrom}>
            <FastForward className="ue:h-3.5 ue:w-3.5" /> {t('从这步跑到底')}
          </ui.Button>
        )}
        {canLocate && (
          <ui.Button
            size="sm"
            variant="secondary"
            title={
              online ? t('对着游戏里此刻的界面找这个控件，找得到就在游戏窗口里框 2.5 秒；不点它、不改东西') : offlineWhy
            }
            disabled={!online || running || locating}
            onClick={() => void locate()}
          >
            {locating ? (
              <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />
            ) : (
              <LocateFixed className="ue:h-3.5 ue:w-3.5" />
            )}{' '}
            {t('在游戏里框出来')}
          </ui.Button>
        )}
        {asset && (
          <ui.Button
            size="sm"
            variant="ghost"
            title={editor.editorOn ? asset : t('要先打开 UE 编辑器')}
            disabled={!editor.editorOn}
            onClick={() => void editor.open(asset)}
          >
            <ExternalLink className="ue:h-3.5 ue:w-3.5" /> {t('打开界面资源')}
          </ui.Button>
        )}
        {onEdit && (
          <ui.Button size="sm" variant="ghost" disabled={running} onClick={onEdit}>
            <Pencil className="ue:h-3.5 ue:w-3.5" /> {t('编辑')}
          </ui.Button>
        )}
      </div>
      {found && (
        <p className="ue:flex ue:items-start ue:gap-1.5 ue:text-footnote">
          <span className="ue:mt-0.5">
            <CheckMark check={[found]} />
          </span>
          {found.found ? (
            <span className="ue:min-w-0 ue:text-muted">
              {t('此刻找得到：{c}{v}，已在游戏窗口里框出', {
                c: found.class ?? '?',
                v: found.visible === false ? t('（不可见）') : found.enabled === false ? t('（禁用）') : '',
              })}
              {found.text && <span className="ue:ml-1 ue:text-subtle">「{found.text}」</span>}
            </span>
          ) : (
            <span className="ue:min-w-0 ue:whitespace-pre-wrap ue:break-all ue:text-danger">
              {found.error || t('此刻找不到')}
            </span>
          )}
        </p>
      )}
    </>
  )
}
