import { useEffect, useRef } from 'react'
import { op, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { useKept } from '../keep.ts'
import { useExtEvents } from '../sections/uekit/ListCol.tsx'

/** UELink 2.4 editor.selection 的回包（UEKit docs/protocol.md） */
export interface EditorSelection {
  actors: { path: string; name: string; label?: string; class: string; world: string }[]
  actorCount: number
  assets: { path: string; name: string; class: string }[]
  folders: string[]
  blueprint?: { path: string; graph?: string; nodes: { id: string; title: string }[] }
}

/** 编辑器进程（选中只在编辑器里有）和它认不认 editor.selection（旧 UELink 不认，整块不显示） */
export function useEditorInstance() {
  const { state } = useUe()
  const inst = (state?.instances ?? []).find((i) => i.kind === 'editor' && i.online)
  return { inst, supported: !!inst?.ops?.includes('editor.selection') }
}

/**
 * 编辑器里现在选中了什么（设计稿「UE 插件优化与扩展」二 P0）：先读一次，之后靠 UELink 推的 uelink.selection 更新，不轮询。
 * 推送只有关卡和内容浏览器的选中（蓝图节点没有变化通知），蓝图那块在每次重读时顺带刷新
 */
export function useEditorSelection() {
  const { project } = useUe()
  const { inst, supported } = useEditorInstance()
  const res = useLoad(
    () =>
      supported && inst
        ? op<EditorSelection>(project.id, 'editor.selection', {}, { instance: inst.pid })
        : Promise.resolve(undefined),
    [project.id, inst?.pid, supported],
    0,
    `${project.id}/editorSelection`,
  )
  useExtEvents(project.id, (e) => {
    if (e.event !== 'uelink.selection' || !supported) return
    const ev = e as unknown as EditorSelection
    res.setData({ ...ev, blueprint: res.data?.blueprint })
  })
  return { ...res, supported, inst }
}

/** 「跟随」开关：开着时编辑器里选中变了，面板跟到那一个。默认关（设计稿第六节第 3 问：跟着跳会打扰人），按项目和页面记 */
export function useFollow(page: 'objects' | 'assets') {
  const { project } = useUe()
  return useKept(`${project.id}/${page}/followSelection`, false)
}

/**
 * 跟随：开着时选中的第一个变了就调 onChange。
 * 打开开关那一下的跳转不在这里做：SelectionBar 先重读选中、拿到最新的再跳（缓存的选中可能是旧的，
 * 直接跳会先跳旧的再跳新的，导航历史多一条，PR #207 评审指出）。返回的 sync 把「上一次看到的」对齐到重读结果，免得这里再跳一遍
 */
export function useFollowEffect(first: string | undefined, on: boolean, onChange: (path: string) => void) {
  const last = useRef(first)
  const fn = useRef(onChange)
  fn.current = onChange
  useEffect(() => {
    const changed = first !== last.current
    last.current = first
    if (on && first && changed) fn.current(first)
  }, [first, on])
  return (path: string | undefined) => {
    last.current = path
  }
}
