import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { objLibFile } from '../obj-lib/store.ts'
import { luaFnFile } from '../uekit/gt-luafn/store.ts'
import { GM_EVENT, gmFile } from '../store.ts'
import type { UeProject } from '../types.ts'
import { c } from '../util.ts'

/**
 * gm.json、objects.json、GameTest 的函数库 gametest-lua.json 在面板外被改了（别人提交后拉下来、手改）也让打开着的 GM 页刷新：一个项目盯这两个文件，
 * 停手后推一次 gm 事件。面板自己写的在 writeGm 里已经推过，这里多推一次只是多读一次。
 * 监听走面板共用的 server/watch/files（面板 ADR 0074）：盯所在目录、改名替换保存不丢、同一目录和别的订阅者共用句柄。
 * GM 页第一次取 gm.json 时开始盯，一个项目一个
 */
const watchers = new Map<string, { file: string; close: () => void }>() // 模块状态：丢了下次取 gm.json 时重盯

export async function followGm(p: Pick<UeProject, 'id' | 'root' | 'gmStore'>) {
  const file = gmFile(p)
  const cur = watchers.get(p.id)
  if (cur?.file === file) return
  unfollowGm(p.id)
  try {
    await mkdir(path.dirname(file), { recursive: true })
    const { watchFiles } = await import('@panel/server/watch/files')
    // 等加载的时候别的调用可能已经登记了
    if (watchers.has(p.id)) return
    const w = watchFiles([file, objLibFile(p), luaFnFile(p)], () => c().pages?.push(GM_EVENT, { project: p.id }))
    watchers.set(p.id, { file, close: w.close })
  } catch {
    // 目录建不了、没权限：只是外面改了不自动刷新，GM 页「刷新」照样能用
  }
}

export function unfollowGm(id: string) {
  const w = watchers.get(id)
  if (!w) return
  w.close()
  watchers.delete(id)
}

export function stopGmWatch() {
  for (const id of [...watchers.keys()]) unfollowGm(id)
}
