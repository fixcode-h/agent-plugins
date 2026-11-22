import { useEffect } from 'react'
import type { GmObject } from '../../../../shared/gm/schema.ts'
import { pget, ppost, useLoad } from '../../../api.ts'
import { h } from '../../../host.ts'

export interface ObjLibData {
  objects: GmObject[]
  objFolders: string[]
  file: string
}

/**
 * 对象库（objects.json，GM 页对象调用和测试页共用，第三期 G5）：读一次，之后收 gm 事件再读（GM 页、ue_gm、外面改了都推），不轮询。
 * save 整份写回
 */
export function useObjLib(project: string) {
  const lib = useLoad(() => pget<ObjLibData>(project, 'objlib'), [project], 0, `objlib/${project}`)
  useEffect(() => {
    const off = h().events.on('gm', (d) => {
      if ((d as { project?: string }).project === project) void lib.reload()
    })
    return off
    // lib.reload 是稳定的；只按项目重新订阅
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [project])
  const save = async (objects: GmObject[], objFolders = lib.data?.objFolders ?? []) => {
    await ppost(project, 'objlib', { objects, objFolders })
    await lib.reload()
  }
  return { data: lib.data, error: lib.error, reload: lib.reload, save }
}
