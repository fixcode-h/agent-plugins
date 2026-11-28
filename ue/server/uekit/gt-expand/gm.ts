import type { UeProject } from '../../types.ts'
import { expandScript, type GmLib } from '../../../shared/gt-script/gm/expand.ts'
import { luaCall } from '../../lua-gm/call.ts'
import { current } from '../../lua-gm/scan.ts'
import { readGm } from '../../store.ts'
import { t } from '../../util.ts'
import { registerScriptExpander } from './registry.ts'

/**
 * 存盘、运行前把脚本里的「执行 GM」（gm.run）按 GM 库重新展开（shared/gt-script/gm/expand.ts，经 gt-expand/registry.ts）。
 * GM 库在面板这边（gm.json、Lua GM 扫描），GameTest 不读它，所以展开只能在这里做。
 * 没有 gm.run 的脚本不读 GM 库、原样返回
 */
export async function gmLib(p: UeProject): Promise<GmLib> {
  const gm = await readGm(p)
  // Lua GM 的扫描要读脚本文件：只在真有 Lua GM 时用到，出错留着到拼代码时再报
  let scan: Awaited<ReturnType<typeof current>> | undefined
  let scanError = ''
  try {
    scan = await current(p)
  } catch (e) {
    scanError = (e as Error).message
  }
  return {
    gm,
    luaCode: (name, args) => {
      const it = scan?.items.find((x) => x.name === name)
      if (!it)
        return {
          error: scanError || scan?.error || t('没有这个 Lua GM：{name}（GM 页「Lua」来源里能看到全部）', { name }),
        }
      try {
        return { code: luaCall(it, args) }
      } catch (e) {
        return { error: t('Lua GM「{name}」：{e}', { name, e: (e as Error).message }) }
      }
    },
  }
}

// 执行 GM 的展开器：GM 库只在脚本里真有 gm.run 时才读
registerScriptExpander({
  id: 'gm',
  actions: ['gm.run'],
  expand: async (doc, p) => expandScript(doc, await gmLib(p)),
})
