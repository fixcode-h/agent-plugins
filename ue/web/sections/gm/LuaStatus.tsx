import type { LuaGmScan } from '../../../server/lua-gm/types.ts'
import { h, t } from '../../host.ts'
import { fmtTime } from '../../ui.tsx'

/** GM 树底下的 Lua GM 扫描状态：几个文件几条、什么时候扫的、没认出来的，以及「重新扫描」「让 AI 改扫描脚本」 */
export function LuaStatus({
  scan,
  scanning,
  onRescan,
  onFixScript,
  onSetup,
}: {
  scan?: LuaGmScan
  scanning: boolean
  onRescan: () => void
  onFixScript: () => void
  onSetup: () => void
}) {
  const { cn } = h()
  const link = 'ue:cursor-pointer ue:text-accent-text ue:hover:underline ue:disabled:opacity-50'
  if (!scan) return null
  const ready = scan.hasScript && scan.files.length > 0
  return (
    <div className="ue:flex ue:shrink-0 ue:flex-col ue:gap-1 ue:border-t ue:border-line ue:px-3 ue:py-2.5 ue:text-caption ue:text-subtle">
      {ready ? (
        <>
          <span className="ue:flex ue:items-center ue:gap-1.5">
            <span className={cn('ue:h-1.5 ue:w-1.5 ue:rounded-full', scan.error ? 'ue:bg-danger' : 'ue:bg-success')} />
            {t('Lua GM · {f} 个文件 · {n} 条', { f: scan.files.length, n: scan.items.length })}
          </span>
          {scan.error ? (
            <span className="ue:line-clamp-3 ue:text-danger" title={scan.error}>
              {scan.error}
            </span>
          ) : (
            <span>
              {t('{at} 扫描 · {ms} 秒 · 文件变了自动重扫', {
                at: fmtTime(scan.scannedAt),
                ms: (scan.ms / 1000).toFixed(1),
              })}
            </span>
          )}
          {scan.warnings.length > 0 && (
            <span className="ue:text-warning" title={scan.warnings.join('\n')}>
              {t('{n} 条没认出来（悬停看原因）', { n: scan.warnings.length })}
            </span>
          )}
          <span className="ue:flex ue:gap-3">
            <button type="button" className={link} disabled={scanning} onClick={onRescan}>
              {scanning ? t('正在扫描…') : t('重新扫描')}
            </button>
            <button type="button" className={link} onClick={onFixScript}>
              {t('让 AI 改扫描脚本')}
            </button>
          </span>
        </>
      ) : (
        <>
          <span>{scan.error || t('还没设置 Lua GM：选好 GM 文件，让 AI 写一个扫描脚本，以后自动列出')}</span>
          <button type="button" className={cn(link, 'ue:self-start')} onClick={onSetup}>
            {t('Lua GM 扫描设置')}
          </button>
        </>
      )}
    </div>
  )
}
