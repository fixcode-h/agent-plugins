import { clearLogs, logTail, logTargets, projectState, runMacro, undo } from './actions.ts'
import { detect } from './detect.ts'
import { closeBackground, ensureBackground, launchEditor, stopBackground } from './editor.ts'
import { badges } from './badges.ts'
import { clearHistory } from './history.ts'
import { editFavs, moveFavs, readFavs } from './favorites.ts'
import { build, install, uninstall } from './install.ts'
import { cancelJob, getJob } from './jobs.ts'
import { crashes } from './logs.ts'
import { dangerousMatch, runOp, type OpCtx } from './ops.ts'
import { perfRoute } from './perf-api.ts'
import { luaGmRoute } from './lua-gm/api.ts'
import { luaBuildRoute } from './lua-build/api.ts'
import { toolsRoute } from './editor-tools/api-tools.ts'
import { extRoute } from './uekit/api-ext.ts'
import { luaRoute } from './lua/api.ts'
import { precheck } from './precheck.ts'
import { luaDebugRoute } from './lua-debug/api.ts'
import { DEFAULT_PERMS, getProject, listProjects, patchProject, removeProject, saveProject } from './registry.ts'
import { patchLocal, pushConsoleHistory, readGm, readLocal, writeGm, type LocalState } from './store.ts'
import type { GmStore, InstallMode, Target, UeProject } from './types.ts'
import { historyWithLive, undoAll } from './undo.ts'
import { json, now, t } from './util.ts'
import { enableFor } from './capability.ts'
import { searchIndexRoute } from './search-index/index.ts'
import { vsDebugRoute } from './vs-debug/api.ts'

/**
 * 网页用的接口（挂在 /api/plugins/ue/ 下）。你在网页上的操作记成 actor=user，不受 Agent 权限限制，
 * 但危险命令照样要先在网页上确认（confirmed=true 才执行）。
 */
type Body = Record<string, unknown>

async function body(req: Request): Promise<Body> {
  return ((await req.json().catch(() => ({}))) ?? {}) as Body
}

function userCtx(project: UeProject, b: Body): OpCtx {
  const target = b.target as Target | undefined
  return {
    project,
    actor: { kind: 'user' },
    target:
      target && (target.instance !== undefined && target.instance !== '' ? true : !!target.world) ? target : undefined,
    confirmed: b.confirmed === true,
  }
}

async function register(b: Body) {
  const id = String(b.id ?? '')
  const det = await detect(String(b.path ?? ''), String(b.engineDir ?? ''))
  if (!det.ok) throw new Error(det.error)
  const p: UeProject = {
    id,
    name: String(b.name ?? det.uname),
    root: det.root,
    uproject: det.uproject,
    uname: det.uname,
    engine: det.engine,
    cpp: det.cpp,
    vcs: det.vcs,
    perms: { ...DEFAULT_PERMS, ...((b.perms as UeProject['perms']) ?? {}) },
    gmStore: b.gmStore === 'local' ? 'local' : 'project',
    favStore: b.favStore === 'project' ? 'project' : 'docs',
    engineDir: String(b.engineDir ?? ''),
    buildCmd: '',
    target: { kind: '', world: '' },
    addedAt: now(),
  }
  const mode = b.mode as InstallMode | 'none' | undefined
  const jobs = []
  if (mode === 'local' || mode === 'vcs') {
    jobs.push(await install(p, mode))
    p.install = { mode, version: det.bridge || '', at: now() }
    jobs.push(await build(p))
  }
  await saveProject(p)
  // 按项目生效（插件接口 9）：在 UE 页接入了，就顺手在这个项目的「能力」里打开 UE
  await enableFor(p.id)
  return { project: p, jobs: jobs.map((j) => j.id) }
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const post = req.method === 'POST'
  try {
    if (parts[0] === 'projects' && parts.length === 1)
      return post ? json(await register(await body(req))) : json({ projects: await listProjects() })
    if (parts[0] === 'detect' && post) {
      const b = await body(req)
      return json(await detect(String(b.path ?? ''), String(b.engineDir ?? '')))
    }
    if (parts[0] === 'jobs' && parts[1] && parts[2] === 'cancel' && post) {
      if (!(await cancelJob(parts[1]))) return json({ error: t('这个作业已经结束了') }, 409)
      return json({ ok: true })
    }
    if (parts[0] === 'jobs' && parts[1]) {
      const job = getJob(parts[1])
      return job ? json(job) : json({ error: t('作业不存在（面板重启后作业记录会清空）') }, 404)
    }
    if (parts[0] !== 'p' || !parts[1]) return json({ error: 'not found' }, 404)

    const project = await getProject(parts[1])
    if (!project) return json({ error: t('这个项目还没有接入 UE 页') }, 404)
    const b = post ? await body(req) : {}
    const ctx = userCtx(project, b)
    const route = parts.slice(2).join('/')
    switch (`${req.method} ${route}`) {
      case 'GET state':
        return json(await projectState(project))
      case 'POST settings': {
        const patch: Partial<UeProject> = {}
        for (const k of ['perms', 'gmStore', 'favStore', 'buildCmd', 'engineDir', 'target', 'name'] as const)
          if (k in b) (patch as Record<string, unknown>)[k] = b[k]
        if ('engineDir' in b) {
          const det = await detect(project.root, String(b.engineDir ?? ''))
          patch.engine = det.engine
        }
        // 换了收藏的存放位置：把现有的收藏带过去，免得一换就空了
        if (patch.favStore && patch.favStore !== project.favStore)
          await moveFavs(project, { ...project, favStore: patch.favStore })
        return json(await patchProject(project.id, patch))
      }
      case 'POST remove':
        if (b.uninstall) await uninstall(project)
        stopBackground(project.id)
        await removeProject(project.id)
        return json({ ok: true })
      case 'POST install': {
        const mode = b.mode === 'vcs' ? 'vcs' : 'local'
        const job = await install(project, mode, typeof b.prerelease === 'string' ? b.prerelease : '')
        const det = await detect(project.root, project.engineDir)
        await patchProject(project.id, { install: { mode, version: det.bridge, at: now() } })
        return json({ job: job.id, build: (await build(project)).id })
      }
      case 'POST uninstall': {
        const job = await uninstall(project)
        await patchProject(project.id, { install: undefined })
        return json({ job: job.id })
      }
      case 'POST build':
        return json({ job: (await build(project, { force: b.force === true, kill: b.kill === true })).id })
      case 'POST op':
        return json(await runOp(ctx, String(b.op), (b.args as Body) ?? {}, Number(b.timeout) || 30000))
      case 'POST console': {
        const command = String(b.command ?? '').trim()
        const rule = dangerousMatch(command)
        if (rule && !ctx.confirmed) return json({ needConfirm: true, rule })
        await pushConsoleHistory(project.id, command)
        return json(await runOp(ctx, 'console', { command }))
      }
      case 'POST undo':
        return json(await undo(ctx, String(b.id)))
      case 'GET history':
        // 只给最近 1000 条：网页一页看不了更多，文件本身最多留 5000 条；每条带上是否还在生效（能一键撤回）
        return json({ items: await historyWithLive(project) })
      case 'POST undo/all':
        return json(await undoAll(ctx))
      case 'GET badges':
        return json(await badges(ctx, url.searchParams.get('overview') === '1'))
      case 'POST history/clear':
        await clearHistory(project.id)
        return json({ ok: true })
      case 'GET gm':
        return json(await readGm(project))
      case 'POST gm':
        await writeGm(project, b as unknown as GmStore)
        return json({ ok: true })
      case 'POST macro':
        return json(await runMacro(ctx, String(b.id)))
      case 'GET local':
        return json(await readLocal(project.id))
      case 'GET favorites':
        return json(await readFavs(project))
      case 'POST favorites':
        return json(await editFavs(project, b))
      case 'POST local':
        return json(await patchLocal(project.id, b as Partial<LocalState>))
      case 'POST logs':
        return json(await logTail(ctx, b))
      case 'GET logs/targets':
        return json(await logTargets(project))
      case 'POST logs/clear':
        return json(await clearLogs(ctx, (b.pids as number[]) ?? undefined, !!b.backup))
      case 'GET crashes':
        return json({ items: await crashes(project) })
      case 'POST background':
        if (b.action === 'stop') {
          // 按名片 PID 也关：面板上次运行时起的后台编辑器不是这次的子进程
          await closeBackground(project, 'user')
          return json({ ok: true })
        }
        {
          // 网页点「启动后台编辑器」：要 30–60 秒，不等它就绪，进度看目标卡；马上能看出的错（编辑器开着、正在编译）等一下直接报
          const starting = ensureBackground(project)
          starting.catch(() => undefined)
          return json(
            await Promise.race([
              starting.then((c) => ({ pid: c.pid })),
              new Promise((r) => setTimeout(() => r({ starting: true }), 3000)),
            ]),
          )
        }
      // 资源页「提交前检查」（precheck.ts）
      case 'POST precheck':
        return json(await precheck(ctx))
      case 'POST editor':
        return json(await launchEditor(project))
      default: {
        // UEKit 扩展（UE 插件、AssetForge、GameTest）的接口在 uekit/api-ext.ts
        const ext = await extRoute(ctx, `${req.method} ${route}`, b, url)
        if (ext instanceof Response) return ext
        if (ext !== undefined) return json(ext)
        // GM 页 Lua 来源（扫描脚本、参数关联、执行）在 lua-gm/api.ts
        const gmLua = await luaGmRoute(ctx, `${req.method} ${route}`, b)
        if (gmLua !== undefined) return json(gmLua)
        // Lua 页「编译」页签的接口在 lua-build/api.ts
        const lb = await luaBuildRoute(ctx, `${req.method} ${route}`, b)
        if (lb !== undefined) return json(lb)
        // 编辑器小工具（连接诊断、配置和 GameplayTag、修复重定向器）的接口在 editor-tools/api-tools.ts
        const tools = await toolsRoute(ctx, `${req.method} ${route}`, b)
        if (tools !== undefined) return json(tools)
        // Lua 页的本机动作（打开 .lua）在 lua/api.ts
        const lua = await luaRoute(ctx, `${req.method} ${route}`, b)
        if (lua !== undefined) return json(lua)
        // Lua 片段（已批准的片段）在 lua-debug/api.ts
        const snippets = await luaDebugRoute(ctx, `${req.method} ${route}`, b)
        if (snippets !== undefined) return json(snippets)
        // 跳转弹窗的本地索引（资源、Lua 模块）在 search-index/
        const idx = await searchIndexRoute(project, `${req.method} ${route}`, url)
        if (idx !== undefined) return json(idx)
        // UE 页「VS 调试」卡片（UEToVS 的调试控制管道）在 vs-debug/api.ts
        const vs = await vsDebugRoute(ctx, `${req.method} ${route}`, b)
        if (vs !== undefined) return json(vs)
        // 性能和内存抓取的接口在 perf-api.ts
        const perf = await perfRoute(ctx, `${req.method} ${route}`, b)
        return perf === undefined ? json({ error: 'not found' }, 404) : json(perf)
      }
    }
  } catch (e) {
    // 出错原样给网页显示（面板硬规则）
    return json({ error: (e as Error).message }, 400)
  }
}
