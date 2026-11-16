import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { readIni } from './config-layers.ts'

/** 磁盘上的 GameplayTag ini（UE 没开时 Tag 树的来源，也给进程的结果补注释）。不依赖 ops.ts，单测直接跑 */
export interface TagRow {
  tag: string
  comment?: string
  source?: string
}

const TAG_RE = /Tag\s*=\s*"([^"]+)"(?:[^)]*?DevComment\s*=\s*"((?:[^"\\]|\\.)*)")?/

/** 项目和项目插件里的 Tag ini */
async function tagIniFiles(root: string) {
  const files = [path.join(root, 'Config', 'DefaultGameplayTags.ini')]
  const tagsDir = async (dir: string) => {
    for (const n of await readdir(dir).catch(() => [] as string[])) if (/\.ini$/i.test(n)) files.push(path.join(dir, n))
  }
  await tagsDir(path.join(root, 'Config', 'Tags'))
  // 插件目录最多往下找三层（Plugins/分组/插件/Config/Tags）
  const walk = async (dir: string, depth: number) => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || /^(Binaries|Intermediate|Source|Content|Saved)$/i.test(e.name)) continue
      const sub = path.join(dir, e.name)
      if (e.name === 'Config') await tagsDir(path.join(sub, 'Tags'))
      else if (depth > 0) await walk(sub, depth - 1)
    }
  }
  await walk(path.join(root, 'Plugins'), 3)
  return files
}

/** 磁盘上 ini 里写的 Tag（只有显式写出来的；父级由树自己补） */
export async function iniTags(root: string): Promise<TagRow[]> {
  const out = new Map<string, TagRow>()
  for (const file of await tagIniFiles(root)) {
    const ini = await readIni(file)
    if (!ini) continue
    for (const entries of ini.values())
      for (const e of entries) {
        if (!/^(GameplayTagList|RestrictedTagList)$/i.test(e.key) || e.op === '-' || e.op === '!') continue
        const m = TAG_RE.exec(e.value)
        if (!m) continue
        out.set(m[1], { tag: m[1], comment: m[2]?.replace(/\\"/g, '"') || undefined, source: path.basename(file) })
      }
  }
  return [...out.values()].sort((a, b) => a.tag.localeCompare(b.tag))
}

