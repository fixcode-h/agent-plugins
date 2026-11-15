import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { downloadFile } from '@panel/server/download'
import { c, t } from '../util.ts'

/**
 * 访问 GitHub（UEKit 的插件目录、源码包）都走面板的下载（面板开放模块 server/download）：Node 自带的 fetch 不走代理，
 * 国内常常连不上 GitHub，只报一句「fetch failed」；面板的下载会用「设置 · 网络与代理」里的代理、环境变量和本机代理依次重试，
 * 失败时说清楚原因和试过哪些路径。下到插件数据目录的临时文件里再读出来。
 */
export async function netGet(url: string): Promise<Buffer> {
  const tmp = path.join(c().dataDir, 'tmp', randomUUID())
  try {
    await downloadFile(url, tmp, { connections: 1, idleMs: 30000 })
    return await readFile(tmp)
  } catch (e) {
    throw new Error(t('请求 {url} 没成功：{e}', { url, e: (e as Error).message }), { cause: e })
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined)
    await rm(`${tmp}.part`, { force: true }).catch(() => undefined)
    await rm(`${tmp}.part.json`, { force: true }).catch(() => undefined)
  }
}
