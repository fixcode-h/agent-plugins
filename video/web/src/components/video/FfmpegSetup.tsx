// 截帧弹窗里没有 FFmpeg 时显示：一键下载到数据目录，或者填上本机已有的 ffmpeg 路径
import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import type { FfmpegStatus } from '@shared/video'
import { t } from '@shared/i18n'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/lib/toast'
import { videoApi } from '@/lib/video-api'

export function FfmpegSetup({ status, onStatus }: { status: FfmpegStatus; onStatus: (s: FfmpegStatus) => void }) {
  const [mirror, setMirror] = useState(false)
  const [bin, setBin] = useState('')
  const job = status.job
  const pct = job?.total ? Math.round((job.done / job.total) * 100) : 0
  const run = (p: Promise<FfmpegStatus>) => void p.then(onStatus).catch((e) => toast.error((e as Error).message))
  return (
    <div className="vd:mx-auto vd:flex vd:w-full vd:max-w-[520px] vd:flex-col vd:gap-4 vd:py-6">
      <div className="vd:flex vd:flex-col vd:gap-1">
        <h3 className="vd:text-heading vd:font-medium vd:text-fg">{t('截帧要用 FFmpeg')}</h3>
        <p className="vd:text-body vd:text-muted">
          {t('面板用 FFmpeg 从视频里取帧图片，只读原视频、不改它。这台电脑上没找到可用的 ffmpeg。')}
        </p>
      </div>
      {status.downloadable && (
        <div
          className="vd:flex vd:flex-col vd:gap-2 vd:rounded-xl vd:border vd:border-line vd:bg-panel vd:p-4"
          data-surface=""
        >
          <div className="vd:flex vd:items-center vd:gap-2">
            <Button variant="primary" size="sm" disabled={job?.running} onClick={() => run(videoApi.download(mirror))}>
              {job?.running ? (
                <Loader2 className="vd:h-3.5 vd:w-3.5 vd:animate-spin" />
              ) : (
                <Download className="vd:h-3.5 vd:w-3.5" />
              )}
              {job?.running ? t('正在下载 {pct}%', { pct }) : t('下载 FFmpeg（约 29 MB）')}
            </Button>
            {job?.running && (
              <Button variant="ghost" size="sm" onClick={() => run(videoApi.cancelDownload())}>
                {t('取消')}
              </Button>
            )}
            <Checkbox className="vd:ml-auto" checked={mirror} onChange={setMirror} label={t('用国内镜像')} />
          </div>
          {job?.running && <Progress value={pct} label={t('下载进度')} />}
          {job?.error && (
            <p className="vd:text-footnote vd:text-danger">{t('下载失败：{error}', { error: job.error })}</p>
          )}
          <p className="vd:text-footnote vd:text-subtle">{t('下载到数据目录的 video/ 下，只给面板自己用。')}</p>
        </div>
      )}
      <div className="vd:flex vd:flex-col vd:gap-2">
        <label htmlFor="ffmpeg-path" className="vd:text-footnote vd:text-muted">
          {t('已经装了 FFmpeg？填上 ffmpeg 可执行文件的路径')}
        </label>
        <div className="vd:flex vd:gap-2">
          <input
            id="ffmpeg-path"
            value={bin}
            onChange={(e) => setBin(e.target.value)}
            placeholder={t('例如 C:\\ffmpeg\\bin\\ffmpeg.exe')}
            className="vd:h-8 vd:min-w-0 vd:flex-1 vd:rounded-lg vd:border vd:border-line-strong vd:bg-field vd:px-2.5 vd:font-mono vd:text-footnote vd:text-fg vd:outline-none vd:focus:border-focus"
          />
          <Button variant="secondary" size="sm" disabled={!bin.trim()} onClick={() => run(videoApi.setPath(bin))}>
            {t('使用这个路径')}
          </Button>
        </div>
      </div>
    </div>
  )
}
