import { createHash, randomBytes } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Textifier } from '../../sdk/server.ts'
import { diskToPackage } from './asset-query.ts'
import { BridgeError } from './instances.ts'
import { runOp } from './ops.ts'
import { projectForRun } from './registry.ts'
import { t } from './util.ts'

/**
 * 评审看 .uasset 改了什么（面板 ServerPlugin.textify）：面板取改动前后两版的字节各调一次，这里把那一版写成临时文件，
 * 交给桥接的 asset.textify 在编辑器（没开就是后台编辑器）里加载、导出成文本：蓝图给大纲、类默认值和各张图的伪代码，
 * 其他资源给属性（数据表另给行）。编辑器起不来、桥接旧、加载失败都抛错，面板把错误原样写给评审。
 */

/** 有 asset.textify 的桥接版本 */
export const TEXTIFY_BRIDGE = '1.7.0'

/** 同一内容给同一份文本，也省得评审重跑时再加载一遍：按内容哈希记最近转过的 */
const cache = new Map<string, string>()
const CACHE_MAX = 64

function remember(key: string, text: string) {
  cache.set(key, text)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
}

export const ueTextifier: Textifier = {
  exts: ['uasset'],
  async text({ path: rel, cwd, data }) {
    const abs = path.resolve(cwd, rel)
    const project = await projectForRun(undefined, abs)
    if (!project) throw new BridgeError(t('这个项目没在 UE 页接入，转不了 .uasset'))
    const pkg = diskToPackage(abs.replace(/\\/g, '/'), project.root).replace(/\.uasset$/i, '')
    const key = `${pkg}|${createHash('sha1').update(data).digest('hex')}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit

    // 放在项目的 Saved 下：后台编辑器和编辑器都能读到，用完整个目录删掉
    const dir = path.join(project.root, 'Saved', 'AgentPanel', 'textify', randomBytes(6).toString('hex'))
    const file = path.join(dir, path.basename(abs))
    await mkdir(dir, { recursive: true })
    try {
      await writeFile(file, data)
      const res = await runOp(
        { project, actor: { kind: 'user' } },
        'asset.textify',
        // 桥接按 UE 的习惯收正斜杠路径
        { file: file.replaceAll('\\', '/'), package: pkg },
        300000,
      )
      const text = String(res.text ?? '')
      remember(key, text)
      return text
    } catch (e) {
      const msg = (e as Error).message
      // 旧桥接没有这个操作：给出怎么升级，而不是只说「不支持」
      if (/asset\.textify/.test(msg))
        throw new BridgeError(
          t('这个 UE 里的桥接插件是旧版本，不能把资源转成文本：到「桥接与权限」更新到 {v}，重新编译并重启 UE', {
            v: TEXTIFY_BRIDGE,
          }),
        )
      throw e
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
}
