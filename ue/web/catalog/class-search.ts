import { useCallback, useRef } from 'react'
import type { ClassOpt } from '../ClassPicker.tsx'
import { ancestors, searchIndex, useClassIndex } from './class-index.ts'

/**
 * 选类下拉（web/ClassPicker.tsx）的「按输入的字搜」走本地类索引（class-index.ts）：
 * 对象页、GM 对象参数以前每打一个字就问 UE 一次（UE 没开就没有结果），GameTest 选类早就改成了本地索引，
 * 这里让它们共用同一份——打字马上出结果，UE 没开也能从项目文件里选。
 *
 * base：只列这个类自己和它的子类（GM 的对象参数只许选能赋值的类）。
 * 索引还没取到（第一次打开、项目很大）时退回 fallback（原来问 UE 的那个），不让下拉空着
 */
export function useClassSearch(
  project: string,
  o: { base?: string; fallback?: (q: string) => Promise<ClassOpt[]>; limit?: number } = {},
) {
  const { ix } = useClassIndex(project, false, true)
  const cur = useRef({ ix, o })
  cur.current = { ix, o }
  return useCallback(async (q: string): Promise<ClassOpt[]> => {
    const { ix, o } = cur.current
    if (!q.trim()) return []
    if (!ix) return o.fallback ? o.fallback(q) : []
    const base = o.base
    const keep = base
      ? (it: { name: string }) => it.name === base || ancestors(ix, it.name, base).includes(base)
      : undefined
    return searchIndex(ix, q, keep)
      .hits.filter((c) => c.name !== 'Object')
      .slice(0, o.limit ?? 50)
      .map((c) => ({ name: c.name, ...(c.parent ? { note: c.parent } : {}) }))
  }, [])
}
