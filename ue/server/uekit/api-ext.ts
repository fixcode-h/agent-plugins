import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { OpCtx } from '../ops.ts'
import { liveCards } from '../instances.ts'
import type { InstallMode } from '../types.ts'
import { run, t } from '../util.ts'
import { extensionStatus } from './catalog.ts'
import { insideProject, readReportFile, readScenario, scenarioAction } from './gt-files.ts'
import { forgeFileAction } from './forge-files.ts'
import { installExtension, uninstallExtension } from './install-ext.ts'
import { watch } from './stream.ts'

/**
 * UE 页「UE 插件」「AssetForge」「GameTest」用的接口（挂在 /api/plugins/ue/p/<项目>/ext/ 下）。
 * forge.* / gt.* 操作本身走通用的 POST op（ops.ts 按操作分权限、记操作记录），这里只放面板这边的事：
 * 插件目录和安装、推送事件登记、git 里上次提交的配置（属性差异的对比基线）、测试截图、GameTest 场景文件。
 */
type Body = Record<string, unknown>

/** 进程里实际加载的扩展版本：取第一个报了的进程（编辑器优先，liveCards 已按类型排好） */
async function loadedVersions(root: string) {
  const out = new Map<string, string>()
  for (const card of await liveCards(root))
    for (const e of card.extensions ?? []) if (!out.has(e.name)) out.set(e.name, e.version)
  return out
}

export async function extRoute(ctx: OpCtx, route: string, b: Body, url: URL): Promise<Response | Body | undefined> {
  const p = ctx.project
  switch (route) {
    case 'GET ext':
      return extensionStatus(p, await loadedVersions(p.root), url.searchParams.get('refresh') === '1')
    case 'POST ext/install': {
      const job = await installExtension(p, String(b.name), {
        version: b.version ? String(b.version) : undefined,
        mode: b.mode === 'vcs' || b.mode === 'local' ? (b.mode as InstallMode) : undefined,
      })
      return { job: job.id, ok: job.status === 'done' }
    }
    case 'POST ext/uninstall': {
      const job = await uninstallExtension(p, String(b.name))
      return { job: job.id, ok: job.status === 'done' }
    }
    case 'POST ext/watch':
      return watch(p, String(b.conn ?? ''))
    case 'POST ext/baseline': {
      // 属性差异「对比：上次提交的配置」：git 里 HEAD 的版本，P4 里工作区同步到的版本（#have）；没提交过时说清楚
      const file = insideProject(p.root, String(b.file ?? ''))
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
    case 'POST ext/gt/scenario':
      // GameTest 页的步骤列表：场景文件里的每一步（没跑过的场景也要能看到）
      return { ...(await readScenario(p.root, String(b.root ?? ''), String(b.path ?? ''))) }
    case 'POST ext/gt/report':
      // gt.report 太长时 UE 写成文件只回路径：页面要每一步的结果，从这份文件取
      return readReportFile(p.root, String(b.file ?? ''))
    case 'POST ext/gt/file':
      // GameTest 页场景的右键菜单：改名、复制、删除、在文件夹中显示
      return scenarioAction(p.root, b)
    case 'POST ext/forge/file':
      // AssetForge 页的右键菜单：在文件夹中显示、用编辑器打开（只认配置根里的）
      return forgeFileAction(p.root, b)
    case 'GET ext/file': {
      // GameTest 的截图（Saved/GameTest/... 下的 png）：页面上看步骤截图用
      const rel = url.searchParams.get('path') ?? ''
      const file = insideProject(p.root, rel)
      if (!/\.(png|jpe?g)$/i.test(file)) throw new Error(t('只能看图片'))
      const buf = await readFile(file).catch(() => undefined)
      if (!buf) return new Response(t('文件不存在：{p}', { p: rel }), { status: 404 })
      return new Response(new Uint8Array(buf), {
        headers: { 'content-type': /\.png$/i.test(file) ? 'image/png' : 'image/jpeg', 'cache-control': 'no-store' },
      })
    }
    default:
      return undefined
  }
}
