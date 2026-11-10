import { clearLogs, logTail, logTargets, projectState, runMacro, undo } from './actions.ts'
import { detect } from './detect.ts'
import { ensureBackground, launchEditor, stopBackground } from './editor.ts'
import { badges } from './badges.ts'
import { clearHistory } from './history.ts'
import { build, install, uninstall } from './install.ts'
import { getJob } from './jobs.ts'
import { crashes } from './logs.ts'
import { dangerousMatch, runOp, type OpCtx } from './ops.ts'
import { DEFAULT_PERMS, getProject, listProjects, patchProject, removeProject, saveProject } from './registry.ts'
import { patchLocal, pushConsoleHistory, readGm, readLocal, writeGm, type LocalState } from './store.ts'
import type { GmStore, InstallMode, Target, UeProject } from './types.ts'
import { historyWithLive, undoAll } from './undo.ts'
import { json, now, t } from './util.ts'

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
        for (const k of ['perms', 'gmStore', 'buildCmd', 'engineDir', 'target', 'name'] as const)
          if (k in b) (patch as Record<string, unknown>)[k] = b[k]
        if ('engineDir' in b) {
          const det = await detect(project.root, String(b.engineDir ?? ''))
          patch.engine = det.engine
        }
        return json(await patchProject(project.id, patch))
      }
      case 'POST remove':
        if (b.uninstall) await uninstall(project)
        stopBackground(project.id)
        await removeProject(project.id)
        return json({ ok: true })
      case 'POST install': {
        const mode = b.mode === 'vcs' ? 'vcs' : 'local'
        const job = await install(project, mode)
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
        return json({ job: (await build(project, b.force === true)).id })
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
        return json(await badges(ctx))
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
          stopBackground(project.id)
          return json({ ok: true })
        }
        return json(await ensureBackground(project).then((c) => ({ pid: c.pid })))
      case 'POST editor':
        return json({ pid: launchEditor(project) })
      default:
        return json({ error: 'not found' }, 404)
    }
  } catch (e) {
    // 出错原样给网页显示（面板硬规则）
    return json({ error: (e as Error).message }, 400)
  }
}
