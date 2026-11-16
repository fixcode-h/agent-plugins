import path from 'node:path'
import { runOp, type OpCtx } from './ops.ts'
import { run, t } from './util.ts'

/**
 * 资源页「提交前检查」（设计稿「UE 插件优化与扩展」二 P1）：把这次要提交的资源一次校验完。
 * 范围 = 编辑器里改了没保存的包 + 版本管理里改过的 .uasset / .umap（P4 默认变更列表里打开的，git 工作区里改了的），
 * 只认项目 Content 下的（转成 /Game 路径）。校验走 UELink 2.4 的 asset.validate paths，引擎和项目自己的校验器都会跑
 */
export async function precheck(ctx: OpCtx) {
  const p = ctx.project
  const paths = new Set<string>()
  const dirty = (await runOp(ctx, 'asset.dirty', {}).catch(() => ({ items: [] }))) as { items?: { package: string }[] }
  for (const i of dirty.items ?? []) if (i.package.startsWith('/Game/')) paths.add(i.package)
  for (const f of await changedFiles(p.root, p.vcs)) {
    const g = toGamePath(p.root, f)
    if (g) paths.add(g)
  }
  if (!paths.size) return { items: [], errors: 0, warnings: 0, empty: t('没有改过的资源：编辑器里没有没保存的，版本管理里也没有改过的 .uasset') }
  const list = [...paths].slice(0, 200)
  const res = await runOp(ctx, 'asset.validate', { paths: list }, 600000)
  return { ...res, checked: list.length, skipped: paths.size - list.length }
}

/** 版本管理里改过的资源文件（绝对路径）；命令失败时当没有，不挡检查 */
async function changedFiles(root: string, vcs: string): Promise<string[]> {
  const isAsset = (f: string) => /\.(uasset|umap)$/i.test(f)
  if (vcs === 'p4') {
    const r = await run('p4', ['-ztag', '-d', root, 'opened', '-c', 'default'], { cwd: root, timeout: 30000 })
    if (r.code !== 0) return []
    // -ztag 给的是 depot 路径；clientFile 是工作区语法，用 p4 where 太慢，这里按 Content/ 之后的相对路径拼回项目
    return [...r.out.matchAll(/^\.\.\. depotFile (.+)$/gm)]
      .map((m) => m[1].trim())
      .filter(isAsset)
      .map((d) => {
        const i = d.indexOf('/Content/')
        return i >= 0 ? path.join(root, 'Content', d.slice(i + '/Content/'.length)) : ''
      })
      .filter(Boolean)
  }
  if (vcs === 'git') {
    const r = await run('git', ['status', '--porcelain', '--', 'Content'], { cwd: root, timeout: 30000 })
    if (r.code !== 0) return []
    const top = await run('git', ['rev-parse', '--show-toplevel'], { cwd: root })
    const base = top.code === 0 ? top.out.trim() : root
    return r.out
      .split('\n')
      .map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))
      .map((l) => (l.includes(' -> ') ? l.split(' -> ')[1] : l))
      .filter((f) => isAsset(f) && f)
      .map((f) => path.join(base, f))
  }
  return []
}

/** <项目>/Content/UI/WBP_Bag.uasset → /Game/UI/WBP_Bag */
export function toGamePath(root: string, file: string) {
  const rel = path.relative(path.join(root, 'Content'), file).replace(/\\/g, '/')
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return undefined
  return `/Game/${rel.replace(/\.(uasset|umap)$/i, '')}`
}
