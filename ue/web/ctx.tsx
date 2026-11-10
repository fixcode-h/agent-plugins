import { createContext, useContext } from 'react'
import type { ProjectState, Target, UeProject } from '../server/types.ts'

/** UE 页里当前项目的上下文：各分区按它取项目、目标进程和世界、跳转 */
export interface UeCtx {
  project: UeProject
  state?: ProjectState
  reload: () => void
  /** 当前目标（网页上选的，也存进项目登记，Agent 不填 target 时用它） */
  target: Target
  setTarget: (pid: number | undefined, kind: string, world: string) => void
  section: string
  /** 分区里的子位置（选中的 Actor、资源路径…），写进地址 */
  sub: string
  go: (section: string, sub?: string) => void
  /** 左栏分区旁的数字（服务端 badges.ts），概览、操作记录也用 */
  badges?: Badges
  reloadBadges: () => void
  /** 打开截视口浮层、Ctrl+K 跳转 */
  openShot: () => void
  openJump: () => void
}

export interface Badges {
  errors?: number
  warnings?: number
  watch: number
  undoable: number
  dirty: number
}

export const Ctx = createContext<UeCtx | null>(null)

export function useUe() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useUe 只能在 UE 页里用')
  return c
}
