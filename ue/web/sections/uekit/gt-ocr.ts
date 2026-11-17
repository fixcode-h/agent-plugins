import { ppost } from '../../api.ts'
import { h, t } from '../../host.ts'

/**
 * GameTest 录制截图和 OCR 在网页这边的事：开始录制时把「设置 → 插件 → UE」里的截图参数带给 gt.record.start，
 * 停止录制后让面板认截图里的字（服务端 ext/gt/ocr，写进 hint.ocr）。
 */

/** gt.record.start 的 shots：关掉时 false；外扩按百分比存，高度上限按 16:9 跟着宽度算 */
export function shotsArg(): false | Record<string, number> {
  const c = h().config()
  if (c.gtShots === false) return false
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const maxWidth = Math.round(num(c.gtShotMaxWidth, 640))
  return {
    padRatio: num(c.gtShotPad, 50) / 100,
    padMax: Math.round(num(c.gtShotPadMax, 160)),
    maxWidth,
    maxHeight: Math.max(90, Math.round((maxWidth * 9) / 16)),
  }
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
