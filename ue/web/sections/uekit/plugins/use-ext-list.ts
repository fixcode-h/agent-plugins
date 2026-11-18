import { useCallback, useState } from 'react'
import { pget, useLoad } from '../../../api.ts'
import { h } from '../../../host.ts'
import type { ExtList } from './model.ts'

/**
 * UE 插件页的插件列表：打开页面只读服务端缓存（不去 GitHub），「检查更新」是单独的动作才带 refresh=1。
 * 以前把 refresh 计数器放进 useLoad 的依赖：页面首次加载时「检查更新」按钮也跟着转圈，看着像在自动检查；
 * 点过一次后计数器一直非 0，换项目时又会带 refresh=1 自动去 GitHub。拆开后两件事互不牵连（用户定的长期规则：拉 GitHub 只手动）。
 * 用 keepKey 记住上次的结果，回到这一页先显示旧数据，不闪空白
 */
export function useExtList(projectId: string, onChecked: () => void) {
  const list = useLoad(() => pget<ExtList>(projectId, 'ext'), [projectId], 0, `${projectId}/ext-list`)
  const [checking, setChecking] = useState(false)
  const { setData } = list
  const check = useCallback(async () => {
    setChecking(true)
    try {
      setData(await pget<ExtList>(projectId, 'ext?refresh=1'))
      // UELink 的发布清单也一起重读了，项目状态（概况页的「可升级」）要跟上
      onChecked()
    } catch (e) {
      h().toast.error((e as Error).message)
    } finally {
      setChecking(false)
    }
  }, [projectId, setData, onChecked])
  return { list, checking, check }
}
