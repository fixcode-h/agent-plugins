import path from 'node:path'
import type { VsDebugStatus } from '../types.ts'
import { t } from '../util.ts'
import { pipeOne } from './client.ts'
import { overridePath, pipeSupported } from './connect.ts'
import { findEndpoint } from './discover.ts'

/**
 * UE 停在 VS 断点时整个进程冻住，UELink 不回应：面板的 ue_* 工具会报超时、网页显示「编辑器忙」。
 * 这时把原因说清楚（停在哪、先 continue），免得 Agent 以为 UE 卡死了去重启编辑器
 */

/** 停在断点时给人看的一句话；不在 break 时返回空 */
export function breakMessage(st: Pick<VsDebugStatus, 'mode' | 'location' | 'breakpoint' | 'lastReason'> | undefined) {
  if (st?.mode !== 'break') return undefined
  const loc = st.location
  const where = loc?.file
    ? `${path.win32.basename(loc.file)}:${loc.line ?? '?'}`
    : st.breakpoint || st.lastReason || '?'
  return t('UE 停在 VS 断点 {where}（{fn}），先 ue_vs_debug action=continue 继续', {
    where,
    fn: loc?.function || t('未知函数'),
  })
}

/** 只等这么久：它跟在一次已经超时的请求后面，不能再让人多等 */
const NOTE_MS = 1000

/**
 * 按 UE 项目根找 VS 调试状态，停在断点时返回提示；VS 没开、连不上、不是 break 都返回空（只是补充说明，不另报错）。
 * root 是 .uproject 所在目录，uproject 用来在外层解决方案里优先挑这个项目的发现文件
 */
export async function vsBreakNote(root: string, uproject?: string): Promise<string | undefined> {
  if (!pipeSupported()) return undefined
  try {
    const found = await findEndpoint({ root, engineDir: '', uproject })
    if (!found) return undefined
    const st = await pipeOne(
      found.endpoint,
      'status',
      { frames: 0 },
      { connectTimeoutMs: NOTE_MS, readTimeoutMs: NOTE_MS, ...overridePath(found.endpoint.pipe) },
    )
    return breakMessage(st as unknown as VsDebugStatus)
  } catch {
    return undefined
  }
}

/** UELink 名片里的 project 是 .uproject 路径（老版本可能是目录）：换成项目根 */
export function rootOfCard(project: string) {
  return /\.uproject$/i.test(project) ? path.dirname(project) : project
}
