import { op, useAction, useLoad } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import type { Prop } from '../../../details/model.ts'
import { curvesOf, type Curve } from './model.ts'

/**
 * 曲线资源的属性（props，值给足长度：关键帧在 FRichCurve 的 Keys 里）和从里面找出的曲线；
 * 改关键帧走通用的 set（属性路径 FloatCurve.Keys[2].Value），改完重读。
 * UE 改单个键时不会替我们重算 Auto 切线：网页上改了值之后切线按原来的画，在 UE 里打开曲线会重算
 */
export function useCurve(path: string) {
  const { project } = useUe()
  const { busy, run } = useAction()
  const data = useLoad(
    () =>
      op<{ props: Prop[] }>(project.id, 'props', { path, filter: '', maxChars: 200000 }).then((r) => ({ path, ...r })),
    [project.id, path],
    0,
    `${project.id}/curve/props`,
  )
  const props = data.data?.path === path ? data.data.props : undefined
  const curves: Curve[] = curvesOf(props ?? [])
  /** 一次写几个属性（切线模式要同时改插值和切线），全写完再重读 */
  const setMany = (key: string, writes: { prop: string; value: unknown }[]) =>
    run(key, async () => {
      for (const w of writes) await op(project.id, 'set', { path, prop: w.prop, value: w.value })
      void data.reload()
    })
  const removeKey = (c: Curve, index: number) =>
    run('remove', async () => {
      await op(project.id, 'set', { path, prop: `${c.prop}.Keys`, array: 'remove', index })
      void data.reload()
    })
  return { props, curves, error: data.error, busy, setMany, removeKey, reload: () => void data.reload() }
}
