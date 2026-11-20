import { useEffect, useState } from 'react'
import { expandConfig } from '../../../../../shared/forge-doc/include.ts'
import { ppost } from '../../../../api.ts'
import { t } from '../../../../host.ts'
import { stripComments, type UmgConfig } from '../config.ts'
import { loadSubConfigs, refsIn, type SubConfigs } from './refs.ts'

/** 原文解析成子配置：解析不了抛出带原因的错误（画在占位框里） */
function parseSub(file: string, text: string): UmgConfig {
  let v: unknown
  try {
    v = JSON.parse(stripComments(text))
  } catch (e) {
    throw new Error(t('{f} 解析失败：{m}', { f: file, m: (e as Error).message }))
  }
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error(t('{f} 不是 UMG 配置（顶层不是对象）', { f: file }))
  return v as UmgConfig
}

/**
 * 读主配置 ref 到的全部子配置（AssetForge 页才有：要知道配置根和主配置的路径）。
 * 读文件复用「配置原文」用的 ext/forge/read（只认配置根里的 .json）；子配置自己 include 了片段时照主配置一样展开。
 * 主配置没有 ref 时什么都不读。rev 变了（存盘、细节面板改了配置）重读。
 */
export function useSubConfigs(
  project: string,
  root: string | undefined,
  main: string | undefined,
  doc: UmgConfig | undefined,
  rev: unknown,
) {
  const [subs, setSubs] = useState<SubConfigs>()
  const want = !!root && !!main && refsIn(doc?.root).length > 0
  useEffect(() => {
    if (!want || !root || !main) {
      setSubs(undefined)
      return
    }
    let live = true
    const read = (f: string) =>
      ppost<{ text: string }>(project, 'ext/forge/read', { root, path: f }).then((r) => r.text)
    const load = async (file: string) => {
      const text = await read(file)
      const sub = parseSub(file, text)
      if (!/"include"\s*:/.test(text)) return sub
      const cache = new Map([[file, text]])
      const e = await expandConfig(file, async (f) => cache.get(f) ?? read(f).catch(() => undefined))
      if (e.doc && typeof e.doc === 'object') return e.doc as UmgConfig
      throw new Error(e.errors[0] ?? t('{f} 展开 include 失败', { f: file }))
    }
    void loadSubConfigs(main, doc, load).then((s) => {
      if (live) setSubs(s)
    })
    return () => {
      live = false
    }
  }, [project, root, main, doc, want, rev])
  return subs
}
