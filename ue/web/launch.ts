import { useEffect, useState } from 'react'
import type { LaunchProgress } from '../server/types.ts'
import { op, ppost } from './api.ts'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'
import { seedLaunch, useLaunchProgress } from './launch-progress/store.ts'

/** 点了「启动编辑器并开始 PIE」的项目：编辑器连上桥接后自动开 PIE（编辑器加载要几十秒，不能当场等） */
const piePending = new Set<string>()

/** 启动编辑器（空页面、概览共用）；progress 是启动进度（按钮上显示，见 launch-progress/） */
export function useLaunch() {
  const { project, reload } = useUe()
  const [busy, setBusy] = useState(false)
  const progress = useLaunchProgress(project.id)
  return {
    busy,
    progress,
    start: async (pie: boolean) => {
      setBusy(true)
      try {
        seedLaunch(project.id, await ppost<LaunchProgress>(project.id, 'editor'))
        if (pie) piePending.add(project.id)
        // 进度已经显示在按钮上了，只在要自动开 PIE 时提一句
        if (pie) h().toast.success(t('编辑器启动中，连上后自动开始 PIE'))
        reload()
      } catch (e) {
        h().toast.error((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
  }
}

/** 挂在 UE 页上：等到编辑器连上、还没在 PIE，就把排着的 PIE 开起来；开不了原样报错 */
export function usePendingPie() {
  const { project, state, reload } = useUe()
  const editor = state?.instances.find((i) => i.kind === 'editor' && i.online)
  const ready = !!editor && !editor.worlds.some((w) => w.type === 'PIE')
  useEffect(() => {
    if (!ready || !piePending.has(project.id)) return
    piePending.delete(project.id)
    op(project.id, 'pie', { action: 'start', players: 1, netMode: 'standalone' }, { instance: 'editor' })
      .then(() => setTimeout(reload, 800))
      .catch((e: Error) => h().toast.error(e.message))
    // 只在「编辑器刚连上」这一刻触发一次
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, project.id])
}
