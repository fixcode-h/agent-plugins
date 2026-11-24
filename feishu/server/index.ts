import { chmod, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ActivateServer } from '../../sdk/server.ts'
import { callsLarkCli } from '../shared/feishu/shell.ts'
import { AuditLog } from './feishu/audit.ts'
import { larkVersion, runLark } from './feishu/cli.ts'
import { locateLark } from './feishu/locate.ts'
import type { GateConfig } from './feishu/gate.ts'
import { GrantStore } from './feishu/grants.ts'
import type { RunDeps } from './feishu/run-op.ts'
import { feishuCatalogTools, feishuTools } from './feishu/tools.ts'

/**
 * 飞书插件的服务端入口（面板插件接口 17，设计稿：飞书插件）。
 * 全局生效、手动安装；只经本机已登录的 lark-cli 读写飞书，权限闸在 feishu/gate.ts。
 * Agent 在终端直接调 lark-cli 由工具前钩子拦（block-lark-cli），间接调用由 PATH 垫片（bin/）挡
 */

const HOOK = 'block-lark-cli'
/** 长内容缓存留多久（问题 Q5：写插件数据目录，24 小时后清） */
const CACHE_HOURS = 24

const activate: ActivateServer = (ctx) => {
  const grants = new GrantStore(path.join(ctx.dataDir, 'grants'))
  const audit = new AuditLog(path.join(ctx.dataDir, 'audit'))
  const cacheRoot = path.join(ctx.dataDir, 'cache')
  const cfg = () => ctx.config()
  const shimDir = path.join(ctx.dir, 'bin')
  const located = (force = false) => locateLark(String(cfg().cliPath ?? '').trim(), shimDir, force)
  const bin = async () => (await located())?.path ?? ''
  const gateConfig = (): GateConfig => ({
    refAsk: cfg().refAsk !== false,
    discover: cfg().discover === 'deny' ? 'deny' : 'ask',
    trustedSpaces: String(cfg().trustedSpaces ?? '')
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  })
  const deps = (): RunDeps => ({
    resolver: { bin, cwd: () => ctx.dataDir },
    grants,
    audit,
    config: gateConfig,
    cacheDir: (taskId) => path.join(cacheRoot, taskId.replace(/[^\w.-]/g, '_')),
  })

  // 启动时：垫片补上可执行位（zip 包里不带权限位）、清过期的授权表、审计和缓存
  void (async () => {
    for (const f of ['lark-cli']) await chmod(path.join(ctx.dir, 'bin', f), 0o755).catch(() => {})
    await grants.sweep().catch(() => {})
    await audit.sweep().catch(() => {})
    if (existsSync(cacheRoot)) {
      const cut = Date.now() - CACHE_HOURS * 3_600_000
      for (const d of await readdir(cacheRoot).catch(() => [] as string[])) {
        const p = path.join(cacheRoot, d)
        if (((await stat(p).catch(() => undefined))?.mtimeMs ?? 0) < cut) await rm(p, { recursive: true, force: true })
      }
    }
  })()

  const summary =
    '飞书文档、表格、多维表格、评论、知识库、妙记：只经本机 lark-cli，按用户给的链接授权，其余操作弹卡确认。'
  const hint =
    '飞书链接（feishu.cn / larksuite.com）一律用 feishu_* 工具读写，不要在终端跑 lark-cli（会被拦下）。用户贴过的链接可以直接读；其余文档、搜索、写入都会弹卡请用户确认，等用户点完才返回。'
  const server = { name: 'feishu', summary, tools: () => feishuTools(deps) }

  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })

  return {
    tools: async (run) => {
      if (run.dryRun) return { servers: [server], hint }
      await grants.setParent(run.taskId, run.parentTaskId).catch(() => {})
      return { servers: [server], hint }
    },
    catalog: () => ({
      servers: [
        {
          name: 'feishu',
          summary,
          attach: ctx.t('所有对话（全局插件）'),
          hint,
          tools: feishuCatalogTools,
        },
      ],
    }),
    hook: (id, input) => {
      if (id !== HOOK || cfg().allowShell === true) return undefined
      const command = String(input.tool?.input?.command ?? '')
      if (!callsLarkCli(command)) return undefined
      return {
        deny: true,
        reason:
          '飞书只能用 feishu_* 工具读写（feishu_doc、feishu_sheet、feishu_base、feishu_comment、feishu_search、feishu_wiki、feishu_markdown、feishu_minutes），权限由面板按用户给的链接管，不能在终端直接调 lark-cli。' +
          '用户明确要求跑这条原始命令时，请用户放行；放行后重跑时在命令前加环境变量 FEISHU_LARK_RAW=1（绕过面板放在 PATH 里的拦截垫片）。',
      }
    },
    status: async () => {
      // 设置页点「重新检测」时重新找：用户刚装好、刚改了路径
      const found = await located(true)
      const where = {
        bin: found?.path ?? '',
        binFrom: found?.from ?? '',
        configured: String(cfg().cliPath ?? '').trim(),
      }
      const version = await larkVersion(found?.path ?? '', ctx.dataDir).catch(() => '')
      if (!version) return { cli: '', ...where }
      const auth = await runLark({ bin: found!.path, args: ['auth', 'status'], cwd: ctx.dataDir, timeoutMs: 20_000 })
      return {
        cli: version,
        ...where,
        login: auth.ok ? JSON.stringify(auth.data ?? {}).slice(0, 600) : '',
        loginError: auth.ok ? '' : (auth.error?.message ?? ''),
      }
    },
    fetch: async (req) => {
      const url = new URL(req.url)
      const p = url.pathname.replace(/\/+$/, '')
      if (p === '/audit' && req.method === 'GET')
        return json(
          await audit.list({
            limit: Number(url.searchParams.get('limit') ?? 200),
            q: url.searchParams.get('q') ?? '',
            taskId: url.searchParams.get('task') ?? undefined,
          }),
        )
      if (p === '/audit' && req.method === 'DELETE') {
        await audit.clear()
        return json({ ok: true })
      }
      return json({ error: 'not_found' }, 404)
    },
  }
}

export default activate
