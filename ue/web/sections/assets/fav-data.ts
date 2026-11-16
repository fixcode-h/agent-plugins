import { pget, ppost, useLoad } from '../../api.ts'
import { h } from '../../host.ts'

const NONE: string[] = []

/**
 * 资源页收藏的文件夹（服务端 server/favorites.ts）：存在项目的文档根或 .agent-panel 里，设置 → 权限与设置里选。
 * 改动按动作发（加、删、挪位置），网页先改本地列表再等服务端回最新的整份
 */
export function useFavFolders(projectId: string) {
  const load = useLoad(() => pget<{ folders: string[]; file: string }>(projectId, 'favorites'), [projectId])
  const folders = load.data?.folders ?? NONE
  const send = (body: { action: 'add' | 'remove' | 'move'; path: string; to?: number }, optimistic: string[]) => {
    load.setData({ folders: optimistic, file: load.data?.file ?? '' })
    void ppost<{ folders: string[]; file: string }>(projectId, 'favorites', body).then(
      (r) => load.setData(r),
      (e: Error) => {
        h().toast.error(e.message)
        void load.reload()
      },
    )
  }
  return {
    folders,
    /** 收藏文件的绝对路径（提示里给用户看存在哪） */
    file: load.data?.file ?? '',
    error: load.error,
    has: (p: string) => folders.includes(p),
    toggle: (p: string) =>
      folders.includes(p)
        ? send(
            { action: 'remove', path: p },
            folders.filter((x) => x !== p),
          )
        : send({ action: 'add', path: p }, [...folders, p]),
    /** 把 p 挪到第 to 个（按挪走它之后的列表算） */
    move: (p: string, to: number) => {
      const rest = folders.filter((x) => x !== p)
      send({ action: 'move', path: p, to }, [...rest.slice(0, to), p, ...rest.slice(to)])
    },
  }
}
export type FavFolders = ReturnType<typeof useFavFolders>
