import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { OpCtx } from '../ops.ts'
import { fileAbs, matchFiles, patchConfig, readConfig } from './config.ts'
import { scriptPrompt } from './prompt.ts'
import { runLuaGm } from './run.ts'
import { current, scan } from './scan.ts'
import type { LuaGmBinding } from './types.ts'

type Body = Record<string, unknown>

/**
 * GM 页 Lua 来源的网页接口（挂在 /p/<项目>/lua-gm…）。返回 undefined 表示不是这里的路由。
 * 扫描结果变了由 scan.ts 推 lua-gm 事件，网页收到再 GET，不轮询
 */
export async function luaGmRoute(ctx: OpCtx, route: string, b: Body): Promise<unknown> {
  const p = ctx.project
  switch (route) {
    case 'GET lua-gm':
      return { scan: await current(p), config: await readConfig(p) }
    case 'POST lua-gm/scan':
      return { scan: await scan(p), config: await readConfig(p) }
    case 'POST lua-gm/config': {
      const config = await patchConfig(p, {
        files: b.files,
        binding: b.binding as { key?: unknown; value?: LuaGmBinding | null } | undefined,
      })
      // 只改了参数关联不用重扫：关联在网页上和扫描结果合起来用
      return { config, scan: Array.isArray(b.files) ? await scan(p) : await current(p) }
    }
    case 'POST lua-gm/preview': {
      // 设置弹窗里边改边看：这几个模式能找到哪些文件、各多少行
      const patterns = Array.isArray(b.files) ? b.files.map(String).filter((x) => x.trim()) : []
      const { files } = await matchFiles(p.root, patterns)
      const items = await Promise.all(
        files.slice(0, 200).map(async (f) => {
          const text = await readFile(fileAbs(p.root, f), 'utf8').catch(() => '')
          return { path: f, lines: text ? text.split('\n').length : 0 }
        }),
      )
      return { files: items, total: files.length }
    }
    case 'POST lua-gm/run':
      return runLuaGm(ctx, String(b.name ?? ''), Array.isArray(b.args) ? b.args : [])
    case 'POST lua-gm/prompt':
      return { text: await scriptPrompt(p, b.mode === 'fix' ? 'fix' : 'create', String(b.note ?? '')) }
    default:
      return undefined
  }
}
