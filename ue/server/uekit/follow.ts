import { rpc, type Card } from '../instances.ts'
import type { UeProject } from '../types.ts'
import { pushExt } from './stream.ts'

/**
 * 后台编辑器（commandlet）没有推送通道，AssetForge 的导入导出作业在里面跑时收不到 forge.job 事件。
 * 这里由面板服务端每秒问一次 forge.job，把结果照推送通道的事件格式（phase: progress / finished）推给网页，
 * 网页不用区分作业是在编辑器里还是在后台编辑器里跑的，也不用自己轮询。
 */
const following = new Set<string>()

export function followJob(p: UeProject, card: Card, id: string) {
  const key = `${p.id}/${id}`
  if (following.has(key)) return
  following.add(key)
  pushExt(p.id, { event: 'forge.job', id, status: 'running', phase: 'started' })
  const tick = async () => {
    let job: Record<string, unknown> | undefined
    try {
      job = (await rpc(card, 'forge.job', { id }, 10000)).job as Record<string, unknown> | undefined
    } catch (e) {
      job = { id, status: 'failed', error: (e as Error).message }
    }
    const running = job?.status === 'running'
    pushExt(p.id, {
      ...(job ?? { id, status: 'failed' }),
      event: 'forge.job',
      phase: running ? 'progress' : 'finished',
    })
    if (running) setTimeout(() => void tick(), 1000)
    else following.delete(key)
  }
  setTimeout(() => void tick(), 500)
}
