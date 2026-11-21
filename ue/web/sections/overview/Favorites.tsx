import { Camera, SquareTerminal, Star, Wand2 } from 'lucide-react'
import type { GmStore } from '../../../server/types.ts'
import { op, pget, ppost, useAction, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Card } from '../../ui.tsx'
import { argsText } from '../../../shared/gm/favs.ts'
import { FIXED_BODY } from './Instances.tsx'

/** 常用（从原来的概览搬过来）：宏、收藏的 GM 和控制台命令一键执行，外加截视口 */
export function Favorites() {
  const { project, target, openShot } = useUe()
  const { toast } = h()
  const { busy, run } = useAction()
  const gm = useLoad(() => pget<GmStore>(project.id, 'gm'), [project.id])
  const g = gm.data
  // 宏：收藏了的；一个都没收藏时照旧列全部（以前「常用」就是全部宏）
  const macros = g?.favs.macro.length
    ? g.favs.macro.flatMap((f) => g.macros.filter((m) => `macro:${m.id}` === f.key))
    : (g?.macros ?? [])
  const customName = (id: string) => g?.custom.find((c) => c.id === id)?.name ?? id
  const favs = [
    ...macros.map((m) => ({
      key: `m:${m.id}`,
      icon: Wand2,
      label: t('{name}（宏 · {n} 步）', { name: m.name, n: m.steps.length }),
      run: () => ppost(project.id, 'macro', { id: m.id, target }),
    })),
    ...[...(g?.favs.gm ?? []), ...(g?.favs.engine ?? [])].map((f, i) => {
      const [src, ...rest] = f.key.split(':')
      const name = rest.join(':')
      const list = Array.isArray(f.args) ? f.args : []
      const isConsole = src === 'console'
      return {
        key: `f:${i}:${f.key}`,
        icon: isConsole ? SquareTerminal : Wand2,
        label: [src === 'custom' ? customName(name) : isConsole ? name : name.split('.').pop(), argsText(f.args)]
          .filter(Boolean)
          .join(' '),
        run: () =>
          isConsole
            ? ppost(project.id, 'console', { command: name, target })
            : src === 'custom'
              ? ppost(project.id, 'gm/custom', { id: name, args: Array.isArray(f.args) ? undefined : f.args, target })
              : src === 'lua'
                ? ppost(project.id, 'lua-gm/run', { name, args: list, target })
                : op(project.id, 'gm.run', { name: name.split('.').pop(), args: list }, target),
      }
    }),
  ]
  const chip =
    'ue:flex ue:h-8 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-lg ue:border ue:border-line ue:px-2.5 ue:text-body ue:text-fg ue:hover:bg-hover'
  return (
    <Card
      title={
        <>
          <Star className="ue:h-4 ue:w-4" /> {t('常用')}
        </>
      }
      aside={t('在控制台和 GM 里点星标加到这里')}
    >
      <div className={FIXED_BODY}>
        <div className="ue:flex ue:flex-wrap ue:gap-2 ue:p-4">
          {favs.map((f) => (
            <button
              key={f.key}
              type="button"
              disabled={!!busy}
              onClick={() =>
                void run(f.key, async () => {
                  await f.run()
                  toast.success(t('已执行：{what}', { what: f.label }))
                })
              }
              className={chip}
            >
              <f.icon className="ue:h-3.5 ue:w-3.5 ue:text-subtle" /> {f.label}
            </button>
          ))}
          <button type="button" onClick={openShot} className={chip}>
            <Camera className="ue:h-3.5 ue:w-3.5 ue:text-subtle" /> {t('截视口')}
          </button>
        </div>
      </div>
    </Card>
  )
}
