import { op, useLoad } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { refPath } from '../preview/model.ts'
import type { MatNode } from './model.ts'

type PropList = { props: { name: string; value: unknown }[] }
const toMap = (r: PropList) => Object.fromEntries(r.props.map((p) => [p.name, p.value]))

/** 一次最多读这么多个参数节点的属性（参数名、分组、默认值）；再多的只显示子对象名 */
const MAX_PARAMS = 60

/**
 * 材质参数节点的属性：每个参数节点一次 props（并发），读出参数名、分组、默认值。
 * 读失败的那个参数只显示子对象名，不让整列表出错
 */
export function useParamProps(params: MatNode[]) {
  const { project } = useUe()
  const paths = params.slice(0, MAX_PARAMS).map((p) => p.path)
  const sig = paths.join('|')
  const d = useLoad(
    () =>
      Promise.all(
        paths.map((p) =>
          op<PropList>(project.id, 'props', { path: p, filter: '', maxChars: 400 }, undefined, 60000).then(
            (r) => [p, toMap(r)] as const,
            () => [p, undefined] as const,
          ),
        ),
      ).then((rows) => ({ sig, map: new Map(rows) })),
    [project.id, sig],
  )
  return d.data?.sig === sig ? d.data.map : undefined
}

export interface ChainItem {
  path: string
  class?: string
}

/**
 * 材质实例的父材质链（效果图 B3 右上）：从当前资源沿 Parent 往上找，最多 8 层（防环）。
 * 顺序是从最上面的材质到当前资源；读不到某一层时停在那，error 写原因
 */
export function useParentChain(path: string) {
  const { project } = useUe()
  const d = useLoad(async () => {
    const chain: ChainItem[] = []
    let cur = path
    for (let i = 0; i < 8 && cur; i++) {
      const r = await op<PropList & { object?: { class: string } }>(
        project.id,
        'props',
        { path: cur, filter: 'Parent', maxChars: 400 },
        undefined,
        60000,
      )
      chain.unshift({ path: cur, class: r.object?.class })
      const parent = r.props.find((p) => p.name === 'Parent')?.value
      const p = refPath(parent)
      const next = p && p !== 'None' ? p : ''
      if (!next || chain.some((c) => c.path === next)) break
      cur = next
    }
    return { path, chain }
  }, [project.id, path])
  return { chain: d.data?.path === path ? d.data.chain : undefined, error: d.error }
}
