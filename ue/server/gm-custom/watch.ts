import { watch, type FSWatcher } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { GM_EVENT, gmFile } from '../store.ts'
import type { UeProject } from '../types.ts'
import { c } from '../util.ts'

/**
 * gm.json 在面板外被改了（别人提交后拉下来、手改）也让打开着的 GM 页刷新：盯它所在的目录（编辑器保存时常是改名替换，
 * 盯文件本身会丢事件），停手 300 毫秒推一次 gm 事件。面板自己写的在 writeGm 里已经推过，这里多推一次只是多读一次。
 * GM 页第一次取 gm.json 时开始盯，一个项目一个
 */
const watchers = new Map<string, { file: string; w: FSWatcher; timer?: ReturnType<typeof setTimeout> }>() // 模块状态：丢了下次取 gm.json 时重盯

export async function followGm(p: Pick<UeProject, 'id' | 'root' | 'gmStore'>) {
  const file = gmFile(p)
  const cur = watchers.get(p.id)
  if (cur?.file === file) return
  unfollowGm(p.id)
  const dir = path.dirname(file)
  try {
    await mkdir(dir, { recursive: true })
    const entry: { file: string; w: FSWatcher; timer?: ReturnType<typeof setTimeout> } = {
      file,
      w: watch(dir, (_e, name) => {
        if (name && String(name) !== path.basename(file)) return
        clearTimeout(entry.timer)
        entry.timer = setTimeout(() => c().pages?.push(GM_EVENT, { project: p.id }), 300)
        entry.timer.unref?.()
      }),
    }
    entry.w.on('error', () => unfollowGm(p.id))
    // 盯文件不该让进程一直活着（单测跑完要能退出）
    entry.w.unref()
    watchers.set(p.id, entry)
  } catch {
    // 目录建不了、没权限：只是外面改了不自动刷新，GM 页「刷新」照样能用
  }
}

export function unfollowGm(id: string) {
  const w = watchers.get(id)
  if (!w) return
  clearTimeout(w.timer)
  w.w.close()
  watchers.delete(id)
}

export function stopGmWatch() {
  for (const id of [...watchers.keys()]) unfollowGm(id)
}
