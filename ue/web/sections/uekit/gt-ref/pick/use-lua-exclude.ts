import { useEffect, useMemo, useState } from 'react'
import { pget, ppost } from '../../../../api.ts'

type R = { dirs: string[]; file: string }

/** Lua 类树里排除的目录（存项目文档根，见 server/uekit/gt-ref/lua-exclude.ts）；读不到（示例页、旧版）当没有 */
export function useLuaExclude(project: string) {
  const [dirs, setDirs] = useState<string[]>([])
  useEffect(() => {
    if (!project) return
    let off = false
    pget<R>(project, 'gt-ref/lua-exclude')
      .then((r) => !off && setDirs(r.dirs))
      .catch(() => undefined)
    return () => {
      off = true
    }
  }, [project])
  // 包一层 useMemo：类下拉按它摊树（class-lines.tsx），每次渲染换新对象会让整棵树白算一遍
  return useMemo(() => {
    const edit = (action: 'add' | 'remove', dir: string) => {
      // 先改界面再存：存失败时退回
      setDirs((d) => (action === 'add' ? [...new Set([...d, dir])].sort() : d.filter((x) => x !== dir)))
      void ppost<R>(project, 'gt-ref/lua-exclude', { action, dir })
        .then((r) => setDirs(r.dirs))
        .catch(() => setDirs((d) => (action === 'add' ? d.filter((x) => x !== dir) : [...d, dir].sort())))
    }
    /** 名字（模块或目录）在不在排除的目录下 */
    const isExcluded = (name: string) => {
      if (!dirs.length) return false
      const p = name.split(/[/.]/).filter(Boolean).join('/')
      return dirs.some((d) => p === d || p.startsWith(`${d}/`))
    }
    return { dirs, add: (d: string) => edit('add', d), remove: (d: string) => edit('remove', d), isExcluded }
  }, [dirs, project])
}
