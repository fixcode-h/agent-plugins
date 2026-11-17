import { Download, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { OcrState } from '../server/ocr/install.ts'
import { get, post } from './api.ts'
import { h, t } from './host.ts'
import { fmtSize } from './ui.tsx'

/**
 * 设置 → 插件 → UE 的「OCR」：GameTest 录完认截图里按钮上的字（PP-OCRv5）。
 * 运行时和模型约 70 MB，在这里下载、不进插件包；下载进度由服务端推送（ue-ocr），页面不轮询。
 */
export function OcrSettings() {
  const { ui, toast, events } = h()
  const [s, setS] = useState<OcrState>()
  const [err, setErr] = useState('')
  useEffect(() => {
    get<OcrState>('/ocr').then(setS, (e: Error) => setErr(e.message))
  }, [])
  events.useEvent('ue-ocr', (d) => setS(d as OcrState))

  const act = (path: string) =>
    post<OcrState | { ok: boolean }>(path).then(
      (r) => {
        if ('installed' in r) setS(r)
      },
      (e: Error) => toast.error(e.message),
    )

  const busy = s?.busy
  const pct = busy ? Math.min(100, Math.round((busy.done / Math.max(1, busy.total)) * 100)) : 0
  return (
    <section aria-label="OCR" className="ue:flex ue:flex-col ue:gap-2">
      <span className="ue:text-footnote ue:text-subtle">{t('OCR（认录制截图里的字）')}</span>
      <div className="ue:flex ue:flex-col ue:gap-2 ue:border ue:border-line ue:bg-card ue:px-3.5 ue:py-2.5">
        <div className="ue:flex ue:items-center ue:gap-3">
          <div className="ue:min-w-0 ue:flex-1">
            <div className="ue:text-body ue:text-fg">
              {!s ? t('检测中…') : busy ? t('正在下载') : s.installed ? t('已安装') : t('没装')}
            </div>
            <div className="ue:text-footnote ue:text-subtle">
              {busy
                ? `${busy.step}/${busy.steps} ${busy.what} · ${fmtSize(busy.done)} / ${t('约 {size}', { size: fmtSize(busy.total) })}`
                : s?.installed
                  ? `${s.version ?? ''} · ${fmtSize(s.size ?? 0)}`
                  : t(
                      'GameTest 录完自动认出按钮上的字补进步骤名（中英文、数字、常用符号）。下载 ONNX Runtime 和 PP-OCRv5 模型，约 70 MB，走「网络与代理」的设置',
                    )}
            </div>
          </div>
          {busy ? (
            <ui.Button size="sm" variant="ghost" onClick={() => void act('/ocr/cancel')}>
              <X className="ue:h-3.5 ue:w-3.5" /> {t('取消')}
            </ui.Button>
          ) : s?.installed ? (
            <ui.Button size="sm" variant="ghost" onClick={() => void act('/ocr/remove')}>
              <Trash2 className="ue:h-3.5 ue:w-3.5" /> {t('删除')}
            </ui.Button>
          ) : (
            <ui.Button size="sm" variant="secondary" disabled={!s} onClick={() => void act('/ocr/install')}>
              <Download className="ue:h-3.5 ue:w-3.5" /> {t('下载')}
            </ui.Button>
          )}
        </div>
        {busy && (
          <span
            role="progressbar"
            aria-label={t('OCR 下载进度')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="ue:block ue:h-1 ue:overflow-hidden ue:rounded-(--c-progress-radius) ue:bg-(--c-progress-track)"
          >
            <span className="ue:block ue:h-full ue:bg-accent ue:transition-[width]" style={{ width: `${pct}%` }} />
          </span>
        )}
        {(err || s?.error) && <p className="ue:text-footnote ue:text-danger">{err || s?.error}</p>}
        {s?.needRestart && (
          <p className="ue:text-footnote ue:text-subtle">
            {t('已经停用；有几个文件正被占用，重启面板后再点一次删除就清干净了')}
          </p>
        )}
      </div>
    </section>
  )
}
