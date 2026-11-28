import { useEffect } from 'react'
import type { LuaFnStore } from '../../../../shared/gt-script/luafn/schema.ts'
import { pget, ppost, useLoad } from '../../../api.ts'
import { h } from '../../../host.ts'

export type LuaFnData = LuaFnStore & { file: string; error?: string }

/**
 * GameTest 的 Lua 函数库（服务端 uekit/gt-luafn/store.ts）：编辑页的「脚本函数」节点、Lua 代码节点的「插入函数」、
 * 函数库弹窗共用一份。文件改了（这里存的、Agent 改的、拉下来的）服务端推 gm 事件，这里重读
 */
export function useLuaFns(project: string) {
  const load = useLoad(() => pget<LuaFnData>(project, 'gtlua'), [project], 0, `gtlua/${project}`)
  useEffect(() => {
    if (!project) return
    const off = h().events.on('gm', (d) => {
      if ((d as { project?: string }).project === project) void load.reload()
    })
    return off
    // load.reload 是稳定的；只按项目重新订阅
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [project])
  const save = async (next: LuaFnStore) => {
    const r = await ppost<LuaFnStore>(project, 'gtlua', next)
    load.setData({ ...r, file: load.data?.file ?? '' })
    return r
  }
  return { data: load.data, loading: load.loading, error: load.error || load.data?.error || '', save, reload: load.reload }
}
