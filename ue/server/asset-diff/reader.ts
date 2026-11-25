import { autoBackground, ensureBackground, noBackgroundMsg } from '../editor.ts'
import { BridgeError, liveCards, type Card } from '../instances.ts'
import { editorStartingWhy } from '../launch/bg-guard.ts'
import type { UeProject } from '../types.ts'
import { t } from '../util.ts'

/**
 * 版本差异由谁读（设计稿「UE资源版本差异-修复与强化」1.1、1.3）：固定挑进程，不跟 UE 页记住的目标走。
 * 以前快照调 runOp 不带目标，回落到 UE 页上次选的目标类型：选过后台编辑器时编辑器开着也报「没有找到目标实例」，
 * 选过游戏进程时发给了没有编辑器模块的进程，又被说成「UELink 旧了」。
 * 「编辑器里的那份」只能编辑器读。编辑器没开时比文件版本不走这里，由 snapshot.ts 用自写的读取器直接读文件（用户 2026-11-25），
 * 只有用户点了「启动后台编辑器读」才到这里起后台编辑器
 */

/** 读不了的几种情况：网页按它给不同的出路（诊断、启动后台编辑器、升级 UELink） */
export type ReadFailKind = 'unlinked' | 'no-ue' | 'old-bridge' | 'other'

export class DiffReadError extends BridgeError {
  constructor(
    readonly kind: ReadFailKind,
    message: string,
  ) {
    super(message)
  }
}

/** startBackground：用户在版本差异里点了「启动后台编辑器读」，不看插件参数里的自动启动 */
export async function pickReader(project: UeProject, live: boolean, startBackground = false): Promise<Card> {
  const cards = await liveCards(project.root)
  const editor = cards.find((x) => x.kind === 'editor')
  if (editor) return editor
  if (!live) {
    const bg = cards.find((x) => x.kind === 'background')
    if (bg) return bg
  }
  // 编辑器开着却没有名片：说清是没连上，别让人去起后台编辑器（用户 2026-11-24）
  const why = await editorStartingWhy(project).catch(() => undefined)
  if (why) throw new DiffReadError('unlinked', why)
  if (live) throw new DiffReadError('no-ue', t('编辑器没开：「编辑器里的」那份要编辑器开着才能读，改看「磁盘上的」'))
  if (!startBackground && !autoBackground()) throw new DiffReadError('no-ue', noBackgroundMsg())
  try {
    return await ensureBackground(project)
  } catch (e) {
    throw new DiffReadError('other', (e as Error).message)
  }
}
