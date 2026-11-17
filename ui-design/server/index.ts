import { cp, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import type { ActivateServer } from '../../sdk/server.ts'
import type { Project } from '../shared/schema.ts'
import { DATA_DIR, dataPath, readJson } from './store.ts'
import { designsApi, setDesignsDir } from './designs.ts'
import { adoptOwnersOnce } from './design-owners.ts'
import { TOOLS } from './design-mcp.ts'
import { DESIGN_GUIDES, DESIGN_SUMMARY } from './design-tool-guides.ts'

/**
 * UI 设计插件的服务端入口（面板插件接口 4，ADR 0059；1.4.0 起按项目启用，UI 项目归到面板项目，见 design-owners.ts）：设计的全部接口挂在 /api/plugins/ui-design/api/designs/ 下，
 * AI 改设计用的 design 工具走面板的插件 MCP（design-mcp.ts）。
 *
 * 数据：插件自己的数据目录 plugin-data/ui-design/designs/。以前面板自带 UI 设计时数据在数据目录的 designs/，
 * 第一次打开插件时整个目录挪过来（同一块盘上是改名，瞬间完成；跨盘时复制一份，旧的留着），设计 id、图片路径都不变。
 * 风格库不归插件，面板启动时已经把 designs/_styles.json 读进它自己的 styles.json。
 */
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )

async function migrate(dir: string, log: (msg: string, data?: Record<string, unknown>) => void) {
  const legacy = path.join(DATA_DIR, 'designs')
  if ((await exists(dir)) || !(await exists(legacy))) return
  try {
    await rename(legacy, dir)
    log('已把面板以前的 UI 设计数据挪到插件目录', { from: legacy, to: dir })
  } catch {
    await cp(legacy, dir, { recursive: true })
    await writeFile(
      path.join(legacy, 'MOVED.txt'),
      `UI 设计已经改成插件，这里的数据复制到了 ${dir}，以后读写那边。确认没问题后可以删掉这个目录。\n`,
    ).catch(() => {})
    log('已把面板以前的 UI 设计数据复制到插件目录（跨盘不能直接挪）', { from: legacy, to: dir })
  }
}

/**
 * 面板的项目（只读）：第一版的设计挂在 Agent 项目下，迁移成 UI 项目时按名字和目录建同名的。
 * 文件位置交给面板的 dataPath（现在是数据目录下的 projects/projects.json）：以前拼的是数据目录根下的 projects.json，
 * 那个文件面板早就搬走了，读出来一直是空列表
 */
const projects = {
  list: async () => ((await readJson(dataPath('projects.json'))) as Project[] | null) ?? [],
  get: async (id: string) => (await projects.list()).find((p) => p.id === id) ?? null,
}

const activate: ActivateServer = async (ctx) => {
  const dir = path.join(ctx.dataDir, 'designs')
  await migrate(dir, ctx.log.info)
  setDesignsDir(dir)
  const enable = async (id: string) => {
    try {
      await ctx.projects.enable(id)
    } catch (e) {
      // 面板项目已经删了时不报错，UI 项目照旧在「其他 UI 项目」里
      ctx.log.warn('UI 设计：在项目里打开插件失败', { project: id, error: (e as Error).message })
    }
  }
  const designs = designsApi({
    projects,
    enable,
    adopt: (list) => adoptOwnersOnce(list, { dataDir: ctx.dataDir, panel: projects.list, enable, log: ctx.log.info }),
  })
  // 按项目启用（1.4.0）：启动时就归一次，不然没在任何项目里打开时页面进不去、永远轮不到归属
  void designs.loadProjects().catch((e) => ctx.log.warn('UI 设计：读 UI 项目失败', { error: (e as Error).message }))
  const app = new Hono().route('/designs', designs.routes)
  return {
    fetch: (req) => app.fetch(req),
    // 设置 →「MCP」的能力目录（插件接口 8）：design 工具不经 tools(run)，只在设计页的 AI 对话里自己开会话
    catalog: () => ({
      servers: [
        {
          name: 'design',
          summary: DESIGN_SUMMARY,
          attach: ctx.t('只在 UI 设计页的 AI 对话里（每轮一个会话，只能改这份设计）'),
          tools: () => TOOLS.map((x) => ({ ...x, ...(DESIGN_GUIDES[x.name] && { guide: DESIGN_GUIDES[x.name] }) })),
        },
      ],
    }),
    status: async () => ({ [ctx.t('正在进行的设计任务')]: designs.running() }),
    stop: () => designs.stop(),
  }
}

export default activate
