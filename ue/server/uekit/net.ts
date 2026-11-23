import { netFetch } from '@panel/server/net'
import { t } from '../util.ts'

/**
 * 访问 GitHub（UEKit 的插件目录、源码包）都走面板的出网请求（面板开放模块 server/net 的 netFetch）：Node 自带的 fetch 不走代理，
 * 国内常常连不上 GitHub，只报一句「fetch failed」；netFetch 会用「设置 · 网络与代理」里的代理、环境变量和本机代理依次重试，
 * GitHub 的文件还会按「GitHub 下载来源」换地址取，失败时说清楚原因和试过哪些路径。
 * 以前为了读一个 JSON 先经下载器写到临时文件再读回来（可统一能力盘点第 11 项）。
 */
export async function netGet(url: string): Promise<Buffer> {
  try {
    const r = await netFetch(url, { timeoutMs: 30000 })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  } catch (e) {
    throw new Error(t('请求 {url} 没成功：{e}', { url, e: (e as Error).message }), { cause: e })
  }
}
