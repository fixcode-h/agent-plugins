import { cp, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import type { ActivateServer } from '../../sdk/server.ts'
import type { Project } from '../shared/schema.ts'
import { DATA_DIR, dataPath, readJson } from './store.ts'
import { designsApi, setDesignsDir } from './designs.ts'

/**
 * UI 设计插件的服务端入口（面板插件接口 4，ADR 0059）：设计的全部接口挂在 /api/plugins/ui-design/api/designs/ 下，
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
  const designs = designsApi({ projects })
  const app = new Hono().route('/designs', designs.routes)
  return {
    fetch: (req) => app.fetch(req),
    status: async () => ({ [ctx.t('正在进行的设计任务')]: designs.running() }),
    stop: () => designs.stop(),
  }
}

export default activate
