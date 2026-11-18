import { ppost } from '../../api.ts'
import { h, t } from '../../host.ts'
import { satisfies } from './plugins/model.ts'

/**
 * GameTest 录制截图和 OCR 在网页这边的事：开始录制时把「设置 → 插件 → UE」里的截图参数带给 gt.record.start，
 * 停止录制后让面板认截图里的字（服务端 ext/gt/ocr，写进 hint.ocr）。
 */

/**
 * gt.record.start 的 shots：关掉时 false；外扩按百分比存，高度上限按 16:9 跟着宽度算。
 * GameTest 1.5.0 起外扩有开关（默认关）、左右和上下各一个比例和上限；编辑器里的 GameTest 更旧时
 * 不认这些字段（会报「不认识 padX」），换成旧写法：一个比例管四边，关外扩时比例和上限都给 0、最小尺寸给下限
 */
export function shotsArg(gameTestVersion?: string): false | Record<string, number | boolean> {
  const c = h().config()
  if (c.gtShots === false) return false
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const maxWidth = Math.round(num(c.gtShotMaxWidth, 640))
  const expand = c.gtShotExpand === true
  const padX = num(c.gtShotPadX, 20) / 100
  const padXMax = Math.round(num(c.gtShotPadXMax, 80))
  const padY = num(c.gtShotPadY, 50) / 100
  const padYMax = Math.round(num(c.gtShotPadYMax, 40))
  const size = { maxWidth, maxHeight: Math.max(90, Math.round((maxWidth * 9) / 16)) }
  if (gameTestVersion && !satisfies(gameTestVersion, '>=1.5.0'))
    return expand
      ? { padRatio: Math.max(padX, padY), padMax: Math.max(padXMax, padYMax), ...size }
      : { padRatio: 0, padMin: 0, padMax: 0, minWidth: 16, minHeight: 16, ...size }
  return { expand, padX, padXMax, padY, padYMax, ...size }
}

export interface OcrResult {
  installed: boolean
  named: number
  total: number
}

export const ocrScenario = (project: string, root: string, path: string, force = false) =>
  ppost<OcrResult>(project, 'ext/gt/ocr', { root, path, force })

/**
 * 停止并保存后在后台认字：不挡着用户看录好的场景，认完提示一句再刷新列表（步骤名换成认出来的字）。
 * OCR 没装时只提示一次怎么装；出错原样提示，不重试
 */
export async function ocrAfterRecord(project: string, root: string, path: string, reload: () => void) {
  const { toast } = h()
  const c = h().config()
  if (c.gtShots === false || c.gtOcrAuto === false || !root || !path) return
  try {
    const r = await ocrScenario(project, root, path)
    if (!r.installed) {
      // 面板的提示只有成功和出错两种：这句是提醒，用不刺眼的那种
      if (!hinted) toast.success(t('到「设置 → 插件 → UE」下载 OCR，录完能自动认出按钮上的字补进步骤名'))
      hinted = true
      return
    }
    if (r.named) {
      toast.success(t('认出了 {n} 步的按钮文字', { n: r.named }))
      reload()
    }
  } catch (e) {
    toast.error(t('识别截图文字失败：{e}', { e: (e as Error).message }))
  }
}
let hinted = false
