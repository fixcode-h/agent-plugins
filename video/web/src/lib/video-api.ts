/**
 * 视频截帧的接口（server/video/routes.ts）。拆成插件后挂在面板的 /api/plugins/video/api/ 下
 * （原来是面板自带的 /api/video/…），request 照旧用面板的（自动带上 /api 和令牌）
 */
import type { AutoMode, AutoProgress, EnhanceMethod, FfmpegStatus, VideoRange, VideoSession } from '@shared/video'
import type { DiffBox, FrameShape, NamedRange, VideoPrefs } from '@shared/video-tools'
import { json, request } from '@/lib/api'

const BASE = '/plugins/video/api/video'

type Ref = { key: string; path: string }

export const videoApi = {
  status: () => request<FfmpegStatus>(`${BASE}/status`),
  download: (mirror: boolean) => request<FfmpegStatus>(`${BASE}/ffmpeg/download`, json('POST', { mirror })),
  cancelDownload: () => request<FfmpegStatus>(`${BASE}/ffmpeg/cancel`, json('POST', {})),
  setPath: (path: string) => request<FfmpegStatus>(`${BASE}/ffmpeg/path`, json('PUT', { path })),
  open: (path: string) => request<VideoSession>(`${BASE}/open`, json('POST', { path })),
  manual: (v: Ref, time: number) => request<VideoSession>(`${BASE}/frames/manual`, json('POST', { ...v, time })),
  /** signal：用户点「停止」时断开请求，服务端跟着停掉 FFmpeg；range 为空时整段截 */
  auto: (v: Ref, mode: AutoMode, count: number, range: VideoRange | null, signal?: AbortSignal) =>
    request<VideoSession>(`${BASE}/frames/auto`, { ...json('POST', { ...v, mode, count, range }), signal }),
  /** 自动截帧进行到哪了（没在截时 progress 为 null） */
  progress: (key: string) =>
    request<{ progress: AutoProgress | null }>(`${BASE}/frames/progress?key=${encodeURIComponent(key)}`),
  remove: (v: Ref, o: { which?: 'manual' | 'auto'; ids?: string[] }) =>
    request<VideoSession>(`${BASE}/frames/remove`, json('POST', { ...v, ...o })),
  methods: () => request<{ methods: EnhanceMethod[] }>(`${BASE}/enhance/methods`),
  enhance: (v: Ref, ids: string[], method: string, signal?: AbortSignal) =>
    request<VideoSession>(`${BASE}/frames/enhance`, { ...json('POST', { ...v, ids, method }), signal }),
  unenhance: (v: Ref, ids?: string[]) => request<VideoSession>(`${BASE}/frames/unenhance`, json('POST', { ...v, ids })),
  /** 记下命名范围和弹窗设置 */
  meta: (v: Ref, o: { ranges?: NamedRange[]; prefs?: Partial<VideoPrefs> }) =>
    request<VideoSession>(`${BASE}/meta`, json('POST', { ...v, ...o })),
  shapes: (v: Ref, id: string, shapes: FrameShape[]) =>
    request<VideoSession>(`${BASE}/frames/shapes`, json('POST', { ...v, id, shapes })),
  /** 浏览器画好的标注图（PNG 的 data URL）；from 是底图路径 */
  annotated: (v: Ref, id: string, from: string, png: string) =>
    request<VideoSession>(`${BASE}/frames/annotated`, json('POST', { ...v, id, from, png })),
  dedupe: (v: Ref) => request<{ session: VideoSession; removed: number }>(`${BASE}/frames/dedupe`, json('POST', v)),
  diff: (v: Ref, id: string) =>
    request<{ prev: { id: string; time: number } | null; boxes: DiffBox[] }>(
      `${BASE}/frames/diff`,
      json('POST', { ...v, id }),
    ),
}

/** 浏览器播放用的地址（支持拖进度条） */
export const videoStreamUrl = (path: string) => `/api${BASE}/stream?path=${encodeURIComponent(path)}`
/** 播放器放不出来的格式：这一刻的画面 */
export const videoPreviewUrl = (path: string, t: number) =>
  `/api${BASE}/preview?path=${encodeURIComponent(path)}&t=${t.toFixed(2)}`
/** 帧图片：和附件图片同一个接口读（绝对路径的图片） */
export const frameUrl = (file: string, thumb = false) =>
  `/api/uploads/raw?path=${encodeURIComponent(file)}${thumb ? '&w=240' : ''}`
