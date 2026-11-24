import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { diffReport } from '../../shared/asset-diff/report.ts'
import type { AssetDiff } from '../../shared/asset-diff/types.ts'
import { BridgeError } from '../instances.ts'
import type { UeProject } from '../types.ts'
import { t } from '../util.ts'

/**
 * 「让 Agent 解释」：网页把已经算好的差异发来（不用再读一遍 UE），写成 Markdown 放进项目的 Saved/AgentPanel/diff/，
 * 回相对项目根的路径，网页把「读这个文件解释改动」放进对话输入框。Saved 本来就不进版本管理
 */
export async function explainDiff(project: UeProject, b: Record<string, unknown>): Promise<{ file: string }> {
  const pkg = String(b.path ?? '')
  const diff = b.diff as AssetDiff | undefined
  if (!pkg || !diff?.stats) throw new BridgeError(t('缺少差异内容'))
  const name = pkg.split('/').pop() ?? 'asset'
  // 「（新建）」这类非 ASCII 的说明换成 new，文件名只留字母数字
  const safe = (s: unknown) => String(s ?? '').replace(/[^\w.#-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'new'
  const rel = `Saved/AgentPanel/diff/${safe(name)}_${safe(b.a)}_${safe(b.b)}.md`
  const file = path.join(project.root, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, diffReport(pkg, String(b.a ?? ''), String(b.b ?? ''), diff))
  return { file: rel }
}
