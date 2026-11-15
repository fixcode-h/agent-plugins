import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { LaunchProgress } from '../../server/types.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'

/**
 * 编辑器启动进度（服务端 server/launch/ 推的 ue-launch 事件）。概览页头和「UE 没在运行」空页面的按钮都要显示，
 * 所以放在模块级的小仓库里：UE 页挂一次 useLaunchEvents 收事件、报错和刷新，按钮用 useLaunchProgress 读
 */
const byProject = new Map<string, LaunchProgress>()
const subs = new Set<() => void>()

function set(id: string, p: LaunchProgress | undefined) {
  if (p) byProject.set(id, p)
  else byProject.delete(id)
  for (const f of subs) f()
}

const subscribe = (f: () => void) => {
  subs.add(f)
  return () => void subs.delete(f)
}

export function useLaunchProgress(projectId: string) {
  return useSyncExternalStore(subscribe, () => byProject.get(projectId))
}

/** 点启动后服务端先回一份起始进度，按钮马上就变，不等第一条推送 */
export const seedLaunch = (projectId: string, p: LaunchProgress) => set(projectId, p)

/**
 * 挂在 UE 页上：收推送；刷新过的页面从项目状态里接上正在进行的那一份。
 * 连上了马上刷新状态（按钮换回正常、概览出现编辑器），失败原样报错（面板硬规则）
 */
export function useLaunchEvents() {
  const { project, state, reload } = useUe()
  const { events, toast } = h()
  const fromState = state?.launch
  // reload 每次渲染都是新函数：放进 ref，订阅不用跟着重来
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  useEffect(() => {
    if (!state) return
    const cur = byProject.get(project.id)
    if (fromState) {
      if (!cur || cur.startedAt <= fromState.startedAt) set(project.id, fromState)
    } else if (cur?.status === 'running' && Date.now() - cur.startedAt > 10000) {
      // 服务端已经不在跟这次启动了（面板重启过、推送断过），别让按钮一直转
      set(project.id, undefined)
    }
    // 只在拿到新的项目状态时对一次
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [state, project.id])
  useEffect(
    () =>
      events.on('ue-launch', (d) => {
        const e = d as LaunchProgress & { project: string }
        if (e?.project !== project.id) return
        const cur = byProject.get(project.id)
        // 收到的是旧一次启动的尾巴（重复点了启动），不理
        if (cur && cur.startedAt > e.startedAt) return
        if (e.status === 'running') return set(project.id, e)
        set(project.id, undefined)
        if (e.status === 'failed') toast.error(e.error || t('编辑器启动失败'))
        reloadRef.current()
      }),
    [project.id, events, toast],
  )
}

/** 阶段 id（server/launch/stages.ts）的显示名 */
export function stageLabel(p: LaunchProgress) {
  if (p.waiting === 'rebuild') return t('等你在 UE 弹窗里确认编译')
  if (p.waiting === 'link') return t('UELink 还没连上')
  if (p.shadersLeft && p.stage !== 'final') return t('编译着色器 · 剩 {n}', { n: p.shadersLeft })
  const names: Record<string, string> = {
    spawn: t('启动进程'),
    init: t('初始化引擎'),
    plugins: t('挂载插件'),
    modules: t('加载模块'),
    assets: t('扫描资源'),
    engine: t('初始化编辑器'),
    map: t('加载关卡'),
    final: t('即将完成'),
  }
  return names[p.stage] ?? t('启动中')
}

/** 悬停说明：阶段和着色器个数是日志里读到的，百分比是估算的，要说清楚 */
export function launchTip(p: LaunchProgress, now = Date.now()) {
  const s = Math.max(0, Math.round((now - p.startedAt) / 1000))
  const lines = [
    t('编辑器启动中：{stage}', { stage: stageLabel(p) }),
    t('已用 {s} 秒，约 {pct}%', { s, pct: p.percent }),
    t('阶段从项目日志里读；百分比按阶段和上次启动用时（约 {e} 秒）估算', {
      e: Math.round(p.expectedMs / 1000),
    }),
  ]
  if (p.waiting === 'rebuild') lines.push(t('项目模块要重新编译：切到 UE 的弹窗点「是」，编完会接着启动'))
  if (p.waiting === 'link') lines.push(t('引擎已经起来了，但一直没收到 UELink 的名片：确认项目里装了并启用了 UELink'))
  return lines.join('\n')
}
