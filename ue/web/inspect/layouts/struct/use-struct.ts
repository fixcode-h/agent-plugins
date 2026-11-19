import { op, useLoad } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { parseMembers, type Member } from './model.ts'

/**
 * 结构体的成员和说明：get 能顺着对象引用往里走，一次取 EditorData.VariablesDescriptions（成员定义），再取 EditorData.ToolTip（结构体说明）。
 * 资源没有编辑器数据（烘焙过的包）时 get 报错，原样显示
 */
export function useStruct(path: string) {
  const { project } = useUe()
  const data = useLoad(
    async () => {
      const vars = await op<{ value: unknown }>(project.id, 'get', {
        path,
        prop: 'EditorData.VariablesDescriptions',
        maxChars: 60000,
      })
      const tip = await op<{ value: unknown }>(project.id, 'get', { path, prop: 'EditorData.ToolTip' }).catch(() => ({
        value: '',
      }))
      return { path, members: parseMembers(vars.value), tooltip: typeof tip.value === 'string' ? tip.value : '' }
    },
    [project.id, path],
    0,
    `${project.id}/struct/members`,
  )
  const cur = data.data?.path === path ? data.data : undefined
  return {
    members: cur?.members as Member[] | undefined,
    tooltip: cur?.tooltip ?? '',
    error: data.error,
  }
}
