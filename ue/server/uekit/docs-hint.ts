import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { hintFile, legacyDocsRoot } from './docs-sub.ts'
import { forgeRootFromSetting } from './forge-disk.ts'
import { gtRootsFromSetting } from './gt-disk.ts'

/**
 * 把面板算好的项目文档根交给 UE 里的 AssetForge、GameTest（用户 2026-11-20 定：配置根、场景根统一到文档根下各自的文件夹）：
 * 写进 Saved/AgentPanel/docs-root.txt（协议文档第 6 节），内容一样不重写。
 * 写之前把旧位置（旧规则的 ProjectDoc/docs 或项目 docs）下的 AssetForge/、GameTest/ 复制到新文档根，只在新位置还没有这个目录、
 * 项目设置里也没指定目录时做；旧的不删（可能已经提交进版本管理，删不删由用户定），同名文件不覆盖。
 * 返回搬了哪些目录（日志用）
 */
export async function syncDocsHint(root: string, docsRoot: string) {
  if (!existsSync(root)) return []
  const moved: string[] = []
  // 文档根目录本身要在：UE 那边目录不在就不认提示文件、退回旧规则
  await mkdir(docsRoot, { recursive: true })
  const legacy = legacyDocsRoot(root)
  if (path.resolve(legacy) !== path.resolve(docsRoot)) {
    const pinned = {
      AssetForge: !!(await forgeRootFromSetting(root)),
      GameTest: !!(await gtRootsFromSetting(root)).scenarioRootDir,
    }
    for (const name of ['AssetForge', 'GameTest'] as const) {
      const from = path.join(legacy, name)
      const to = path.join(docsRoot, name)
      if (pinned[name] || existsSync(to) || !existsSync(from)) continue
      await cp(from, to, { recursive: true, force: false, errorOnExist: false })
      moved.push(`${from} → ${to}`)
    }
  }
  const file = hintFile(root)
  const want = `${path.resolve(docsRoot)}\n`
  if ((await readFile(file, 'utf8').catch(() => '')) !== want) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, want)
  }
  return moved
}
