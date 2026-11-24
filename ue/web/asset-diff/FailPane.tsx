import { Play, PlugZap, RefreshCw, Stethoscope } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DiagItem } from '../../server/editor-tools/diagnose.ts'
import type { DiffFailed } from '../../shared/asset-diff/progress.ts'
import { pget, ppost } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { DiagList } from '../sections/uekit/LinkDiagnose.tsx'

/**
 * 读不出差异时按原因给出路（设计稿「UE资源版本差异-修复与强化」3.2）：
 * 编辑器开着没连上 → 直接跑一遍连接诊断列在这里；没有 UE 进程 → 启动后台编辑器读 / 打开编辑器；UELink 旧 → 去升级。
 * 以前只有一行红字，编辑器开着也让人去启动后台编辑器
 */
export function FailPane({
  failed,
  onRetry,
  onClose,
}: {
  failed: DiffFailed
  onRetry: (opts?: { startBackground?: boolean }) => void
  onClose: () => void
}) {
  const { project, go } = useUe()
  const { ui, toast } = h()
  const [diag, setDiag] = useState<DiagItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (failed.kind !== 'unlinked') return
    let live = true
    pget<{ items: DiagItem[] }>(project.id, 'tools/diagnose').then(
      (r) => live && setDiag(r.items),
      () => live && setDiag([]),
    )
    return () => {
      live = false
    }
  }, [failed.kind, project.id])
  const toPlugins = () => {
    onClose()
    go('plugins')
  }
  const openEditor = () => {
    setBusy(true)
    ppost(project.id, 'editor')
      .then(() => toast.success(t('编辑器启动中：加载完、连上 UELink 后点「重新读」')))
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false))
  }
  const retry = (
    <ui.Button size="sm" variant="secondary" onClick={() => onRetry()}>
      <RefreshCw className="ue:h-3.5 ue:w-3.5" /> {failed.kind === 'unlinked' ? t('连上了，重新读') : t('重新读')}
    </ui.Button>
  )
  return (
    <div className="ue:flex ue:max-w-3xl ue:flex-col ue:gap-3 ue:p-5">
      <div className="ue:flex ue:items-start ue:gap-2.5">
        <PlugZap
          className={h().cn(
            'ue:mt-0.5 ue:h-4.5 ue:w-4.5 ue:shrink-0',
            failed.kind === 'other' ? 'ue:text-danger' : 'ue:text-warning',
          )}
        />
        <p className="ue:text-body ue:whitespace-pre-wrap ue:text-fg">{failed.message}</p>
      </div>
      {failed.kind === 'unlinked' &&
        (diag === null ? (
          <p className="ue:text-footnote ue:text-subtle">{t('正在做连接诊断…')}</p>
        ) : (
          diag.length > 0 && <DiagList items={diag} />
        ))}
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
        {failed.kind === 'unlinked' && (
          <ui.Button size="sm" onClick={toPlugins}>
            <Stethoscope className="ue:h-3.5 ue:w-3.5" /> {t('打开连接诊断')}
          </ui.Button>
        )}
        {failed.kind === 'no-ue' && (
          <>
            <ui.Button size="sm" onClick={() => onRetry({ startBackground: true })}>
              <Play className="ue:h-3.5 ue:w-3.5" /> {t('启动后台编辑器读（约 30–60 秒）')}
            </ui.Button>
            <ui.Button size="sm" variant="secondary" disabled={busy} onClick={openEditor}>
              {t('打开编辑器')}
            </ui.Button>
          </>
        )}
        {failed.kind === 'old-bridge' && (
          <ui.Button size="sm" onClick={toPlugins}>
            {t('去「UE 插件」更新')}
          </ui.Button>
        )}
        {failed.kind !== 'no-ue' && retry}
      </div>
    </div>
  )
}
