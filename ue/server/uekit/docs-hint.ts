import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { hintFile, legacyDocsRoot } from './docs-sub.ts'
import { forgeRootFromSetting } from './forge-disk.ts'
import { gtRootsFromSetting } from './gt-disk.ts'

/**
 * 把面板算好的项目文档根交给 UE 里的 AssetForge、GameTest（用户 2026-11-20 定：配置根、场景根统一到文档根下各自的文件夹）：
 * 写进 Saved/AgentPanel/docs-root.txt（协议文档第 6 节），内容一样不重写。
 * 写之前把旧位置（旧规则的 ProjectDoc/docs 或项目 docs）下的 AssetForge/、GameTest/ 并进新文档根，项目设置里指定了目录时不做；
 * 新位置已有的同名文件不覆盖，旧的不删（可能已经提交进版本管理，删不删由用户定）。
 * 返回搬了哪些目录（日志用）
 */
export async function syncDocsHint(root: string, docsRoot: string) {
  if (!existsSync(root)) return []
  const moved: string[] = []
  // 文档根目录本身要在：UE 那边目录不在就不认提示文件、退回旧规则
  await mkdir(docsRoot, { recursive: true })
  const legacy = legacyDocsRoot(root)
  // 每对「旧目录 → 新目录」只并一次（记在 Saved 里，不进版本管理）：以后用户在新位置删掉的文件不会被旧位置再补回来
  const markFile = path.join(root, 'Saved', 'AgentPanel', 'docs-migrated.json')
  await mkdir(path.dirname(markFile), { recursive: true })
  const done = await readFile(markFile, 'utf8').then(
    (t) => JSON.parse(t) as Record<string, string>,
    () => ({}) as Record<string, string>,
  )
  if (path.resolve(legacy) !== path.resolve(docsRoot)) {
    const pinned = {
      AssetForge: !!(await forgeRootFromSetting(root)),
      GameTest: !!(await gtRootsFromSetting(root)).scenarioRootDir,
    }
    for (const name of ['AssetForge', 'GameTest'] as const) {
      const from = path.join(legacy, name)
      const to = path.join(docsRoot, name)
      const key = `${path.resolve(from)} → ${path.resolve(to)}`
      if (pinned[name] || !existsSync(from) || done[key]) continue
      // 新位置已经有这个目录（别的分支先搬过）也要并进来：同名文件不覆盖，只补没有的，免得这个分支的配置、场景留在旧位置看不见
      await cp(from, to, { recursive: true, force: false, errorOnExist: false })
      done[key] = new Date().toISOString()
      moved.push(key)
    }
    if (moved.length) await writeFile(markFile, JSON.stringify(done, null, 2))
  }
  const file = hintFile(root)
  const want = `${path.resolve(docsRoot)}\n`
  if ((await readFile(file, 'utf8').catch(() => '')) !== want) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, want)
  }
  return moved
}
