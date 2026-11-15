import { op, ppost, useAction } from '../../api.ts'
import { h, t } from '../../host.ts'
import { clickFromInspect, type GtInspect } from './gt-steps.ts'

/**
 * 「转成控件步骤」：旧录制里点在 UI 上的坐标点击（input.cursor + 鼠标键）换成 click target=…。
 * 对那个坐标调 gt.inspect，让 GameTest 认出现在接住这一点的控件和选择器，再由面板改场景文件（ext/gt/file replace）。
 * gt.inspect 看的是游戏画面此刻的样子，所以要先让画面停在点这一下之前（例如「从头运行到上一步」）；
 * 认不出控件（点在游戏画面上、界面没打开）时报出来，坐标步骤原样保留，不猜
 */
export function useToWidget(o: { project: string; root: string; path: string; onDone: () => void }) {
  const { busy, run } = useAction()
  const convert = (
    file: { steps: Record<string, unknown>[] },
    span: { start: number; count: number; x: number; y: number; button: string },
  ) =>
    run('convert', async () => {
      const r = await op<GtInspect>(o.project, 'gt.inspect', { x: span.x, y: span.y })
      if (!r.target)
        throw new Error(
          t('({x}, {y}) 这一点现在没有 UI 控件接住：先让游戏画面停在点这一下之前的界面，再转。坐标步骤没改', {
            x: span.x,
            y: span.y,
          }),
        )
      const expect = file.steps.slice(span.start, span.start + span.count)
      const step = clickFromInspect(span, r, expect[0])
      await ppost(o.project, 'ext/gt/file', {
        root: o.root,
        path: o.path,
        action: 'replace',
        index: span.start,
        expect,
        steps: [step],
      })
      h().toast.success(
        r.verified === false
          ? t('已换成 click {s}，但选择器没核对通过，回放前确认一下', { s: r.target })
          : t('已换成 click {s}', { s: r.target }),
      )
      o.onDone()
    })
  return { busy, convert }
}
