import { useCallback } from 'react'
import { ppost } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h } from '../../host.ts'
import { luaFilePath } from './debug-types.ts'

/**
 * 「用编辑器打开到某一行」：走编译页签的 lua-build/open（设置里配的编辑器命令，没配用系统默认程序），
 * 和编译报错跳转同一个入口，不另写一份。打不开（文件不在项目里、不存在）原样提示
 */
export function useOpenLua() {
  const { project } = useUe()
  return useCallback(
    (file: string, line?: number) =>
      void ppost(project.id, 'lua-build/open', { file: luaFilePath(file), line: line ?? 1 }).catch((e: Error) =>
        h().toast.error(e.message),
      ),
    [project.id],
  )
}
