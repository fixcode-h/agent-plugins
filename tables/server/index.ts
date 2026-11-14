import { Hono } from 'hono'
import type { ActivateServer } from '../../sdk/server.ts'
import type { Project } from '../shared/schema.ts'
import { dataPath, readJson } from './store.ts'
import { projectOf, tablesApi } from './tables/routes.ts'
import { readSchema } from './tables/schema-store.ts'
import { enumScanWatcher } from './tables/enum-scan-watch.ts'
import { tableActions } from './actions.ts'
import { reviewTextifier } from './review.ts'
import { tableWatcher } from './tables/watch.ts'

/**
 * 表格插件的服务端入口（面板插件接口 7，ADR 0059；原来是面板自带的表格页，重构文档第 15 条拆出来）：
 * 表格页的接口挂在 /api/plugins/tables/api/tables/ 下，Agent 用的 table.* 面板动作登记进面板的动作表，
 * 评审里的 .xlsx 差异由 textify 按格子比。
 *
 * 数据还放在原来的位置：结构文件在项目目录 .agentpanel/tables/ 或数据目录 tables/<项目 id>/，保存前的备份在数据目录里。
 * 原来面板自带时就在那里，搬过来不用挪；插件删了这些也照样留着，重装后接着用。项目上的表格设置在 project.plugins.tables
 * （面板的数据迁移 0005 从 project.tables 挪过来的）。
 */

/** 面板的项目（只读）：表格设置跟着项目设置一起存在 projects.json，用户在项目设置里改了下次请求就按新的 */
const projects = {
  list: async () => ((await readJson(dataPath('projects.json'))) as Project[] | null) ?? [],
  get: async (id: string) => (await projects.list()).find((p) => p.id === id) ?? null,
}

const activate: ActivateServer = (ctx) => {
  // 外部改动检测：盯着页面上打开着的文件，改了经面板的推送通道（插件接口 7）通知页面
  const watcher = tableWatcher(ctx.pages)
  // 枚举扫描「盯着改动」的规则：后台盯源文件，改了就扫、推给页面；规则改了（保存结构文件）重新同步
  const scanWatch = enumScanWatcher({
    pages: ctx.pages,
    ctxOf: async (id) => {
      const { dir, cfg, schemaAt } = await projectOf({ projects }, id)
      return { dir, cfg, schemaAt, schema: await readSchema(schemaAt) }
    },
    projectIds: async () => (await projects.list()).map((p) => p.id),
  })
  void scanWatch.syncAll()
  const app = new Hono().route('/tables', tablesApi({ projects, watcher, scanWatch }))
  return {
    fetch: (req) => app.fetch(req),
    actions: tableActions,
    textify: reviewTextifier(projects),
    stop: () => {
      watcher.close()
      scanWatch.close()
    },
  }
}

export default activate
