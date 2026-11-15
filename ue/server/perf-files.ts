import { getCapture, setMeta } from './captures.ts'
import { BridgeError } from './instances.ts'
import { revealInFolder } from './reveal.ts'
import type { UeProject } from './types.ts'
import { t } from './util.ts'

/**
 * 抓取文件的右键菜单操作（性能页三期）：在文件夹里显示、重命名。只给网页用，Agent 用不着。
 * 面板只在本机跑（127.0.0.1），打开的是本机的资源管理器 / 访达。
 */
export async function revealCapture(p: UeProject, id: string) {
  const cap = await getCapture(p, id)
  revealInFolder(cap.file)
  return { revealed: cap.file }
}

/** 重命名只改面板里的名字（label），不动磁盘上的文件：Insights、Agent 记着的路径都还能用 */
export async function renameCapture(p: UeProject, id: string, label: string) {
  const cap = await getCapture(p, id)
  const name = label.trim().slice(0, 80)
  if (!name) throw new BridgeError(t('名字不能是空的'))
  await setMeta(p.id, cap.id, { label: name })
  return { id: cap.id, label: name }
}
