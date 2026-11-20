import { useCallback, useEffect, useState } from 'react'
import { expandConfig, originAt, type Expanded } from '../../../../shared/forge-doc/include.ts'
import type { PathSeg } from '../../../../shared/forge-doc/locate.ts'
import { ppost } from '../../../api.ts'

/**
 * 右栏读的那份配置展开 include 之后的样子（设计稿 4.3.4）：按配置预览、标记视图按它画，段导航按它标片段。
 * 主文件的原文由右栏已经读好的传进来（不重复读），片段文件走 ext/forge/read 逐个读（只认配置根里的 .json）。
 * texts 是读到的每份文件的原文（键是相对配置根的路径，含主文件）：「配置原文」切到片段文件时直接用。
 * 解析不了的主文件不展开（返回 undefined），页面照旧显示原文和解析错误。
 */
export interface ForgeExpanded extends Expanded {
  texts: Map<string, string>
  /** 片段文件列表（按第一次出现的顺序）：盯文件、配置原文的文件切换用 */
  fragments: string[]
  fragmentAt: (path: PathSeg[]) => string | undefined
}

/** 每份配置上次展开的结果（模块级，整页刷新才清）：键是「项目 + 主文件」 */
const lastExpanded = new Map<string, { text: string; exp: ForgeExpanded }>()

export function useForgeExpanded(
  project: string,
  configRoot: string,
  main: string | undefined,
  mainText: string | undefined,
  rev: number,
) {
  // 切回看过的配置：主文件原文没变就先用上次展开的结果（片段改了由 rev 触发重新展开），预览第一帧就是完整的树
  const hit = main ? lastExpanded.get(`${project}\n${main}`) : undefined
  const [state, setState] = useState<ForgeExpanded | undefined>(() =>
    hit && hit.text === mainText ? hit.exp : undefined,
  )
  useEffect(() => {
    if (!main || mainText === undefined) {
      setState(undefined)
      return
    }
    let live = true
    const texts = new Map<string, string>([[main, mainText]])
    const read = async (rel: string) => {
      if (texts.has(rel)) return texts.get(rel)
      if (!configRoot) return undefined
      const r = await ppost<{ text: string }>(project, 'ext/forge/read', { root: configRoot, path: rel })
      texts.set(rel, r.text)
      return r.text
    }
    void expandConfig(main, read).then((e) => {
      if (!live) return
      const fragments = [...new Set(e.origins.map((o) => o.file))]
      const exp: ForgeExpanded = { ...e, texts, fragments, fragmentAt: (p) => originAt(e, p)?.file }
      lastExpanded.set(`${project}\n${main}`, { text: mainText, exp })
      setState(exp)
    })
    return () => {
      live = false
    }
  }, [project, configRoot, main, mainText, rev])
  return state
}

/** 稳定的 fragmentAt：没有 include 时给 undefined（标记视图就不去查） */
export function useFragmentAt(exp: ForgeExpanded | undefined) {
  const has = !!exp?.origins.length
  const fn = exp?.fragmentAt
  return useCallback((p: PathSeg[]) => (has && fn ? fn(p) : undefined), [has, fn])
}
