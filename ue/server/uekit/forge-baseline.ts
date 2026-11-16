import path from 'node:path'
import type { UeProject } from '../types.ts'
import { run, t } from '../util.ts'
import { insideProject } from './gt-files.ts'

/**
 * AssetForge 属性差异「对比：上次提交的配置」的基线（页面 ext/baseline 和 ue_forge diff against=commit 共用）：
 * git 里 HEAD 的版本，P4 里工作区同步到的版本（#have）；没提交过时说清楚
 */
export async function configBaseline(p: UeProject, fileArg: string): Promise<{ text: string } | { error: string }> {
  const file = insideProject(p.root, fileArg)
  if (p.vcs === 'p4') {
    const r = await run('p4', ['-d', path.dirname(file), 'print', '-q', `${file}#have`], {
      cwd: path.dirname(file),
      timeout: 30000,
    })
    if (r.code !== 0 || !r.out) return { error: t('P4 里还没有这份配置（新文件，或还没提交）') }
    return { text: r.out }
  }
  if (p.vcs !== 'git') return { error: t('只有 git 和 P4 项目能和上次提交的配置比') }
  const rel = path.relative(p.root, file).replace(/\\/g, '/')
  const r = await run('git', ['-C', p.root, 'show', `HEAD:./${rel}`])
  if (r.code !== 0) return { error: t('git 里还没有这份配置（新文件，或还没提交）') }
  return { text: r.out }
}
