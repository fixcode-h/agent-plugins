import { t } from '../../../host.ts'

/** 设计器的屏幕尺寸预设（照 UE 设计器的预设，效果图 U4）；custom 时用自己填的宽高 */
export interface Screen {
  id: string
  w: number
  h: number
}

export const SCREENS = () => [
  { id: '1920x1080', w: 1920, h: 1080, label: t('桌面 1080p') },
  { id: '2560x1440', w: 2560, h: 1440, label: t('桌面 1440p') },
  { id: '1280x720', w: 1280, h: 720, label: '720p' },
  { id: '2340x1080', w: 2340, h: 1080, label: t('手机横屏') },
  { id: '2048x1536', w: 2048, h: 1536, label: t('平板') },
]

/** 缩放：适应窗口，或固定比例 */
export const ZOOMS = ['fit', '0.25', '0.5', '0.75', '1'] as const
export type Zoom = (typeof ZOOMS)[number]
