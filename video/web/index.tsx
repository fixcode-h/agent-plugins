import { lazy, Suspense } from 'react'
import type { ActivateWeb } from '../../sdk/web.ts'
import { t } from '@shared/i18n'
import { VIDEO_EXTS } from '@shared/video'

const VideoFramesDialog = lazy(() =>
  import('./src/components/video/VideoFramesDialog').then((m) => ({ default: m.VideoFramesDialog })),
)

/**
 * 视频截帧插件的网页入口（面板插件接口 6，ADR 0059）：认领拖进输入框的视频（WebPlugin.attachmentIntakes）。
 * 视频作为卡片留在输入框、只引用原路径，点卡片打开截帧弹窗，选好的帧记在卡片上，发送时换成帧图片（Agent 收不了视频）。
 * 文案在 activate 之后才取：面板先读好包里的英文再调这里。
 */
const activate: ActivateWeb = () => ({
  attachmentIntakes: [
    {
      id: 'frames',
      exts: [...VIDEO_EXTS],
      mimes: ['video/'],
      status: (n) => (n ? t('{n} 帧', { n }) : t('点击选帧')),
      pending: (name) => t('先选好视频「{name}」里要发的帧', { name }),
      Dialog: (p) =>
        p.target ? (
          <Suspense fallback={null}>
            <VideoFramesDialog target={p.target} onClose={p.onClose} onInsert={p.onInsert} />
          </Suspense>
        ) : null,
    },
  ],
})

export default activate
