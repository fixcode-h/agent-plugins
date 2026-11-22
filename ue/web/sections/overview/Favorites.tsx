import { Camera, SquareTerminal, Star, Wand2 } from 'lucide-react'
import type { GmStore } from '../../../server/types.ts'
import { op, pget, ppost, useAction, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Card } from '../../ui.tsx'
import { argsText } from '../../../shared/gm/common.ts'
import { FIXED_BODY } from './Instances.tsx'

/** 常用（从原来的概览搬过来）：宏、收藏的 GM 和控制台命令一键执行，外加截视口 */
export function Favorites() {
  const { project, target, openShot } = useUe()
  const { toast } = h()
  const { busy, run } = useAction()
  const gm = useLoad(() => pget<GmStore>(project.id, 'gm'), [project.id])
  const g = gm.data
  // GM 页的「常用」（gm.json 的 common，用户 2026-11-22 合成一份）：按用户排的顺序，对象只能在 GM 页里调，这里不列；
  // 常用是空的时照旧列全部宏（以前「常用」就是全部宏）
  const common = g?.common.filter((f) => !f.key.startsWith('obj:')) ?? []
  const customName = (id: string) => g?.custom.find((c) => c.id === id)?.name ?? id
  const macroOf = (id: string) => g?.macros.find((m) => m.id === id)
  const macroRow = (m: { id: string; name: string; steps: unknown[] }, i: number) => ({
    key: `m:${i}:${m.id}`,
    icon: Wand2,
    label: t('{name}（宏 · {n} 步）', { name: m.name, n: m.steps.length }),
    run: () => ppost(project.id, 'macro', { id: m.id, target }),
  })
  const favs = !common.length
    ? (g?.macros ?? []).map(macroRow)
    : common.flatMap((f, i) => {
        if (f.key.startsWith('macro:')) {
          const m = macroOf(f.key.slice(6))
          return m ? [macroRow(m, i)] : []
        }
        return [gmRow(f, i)]
      })
  function gmRow(f: (typeof common)[number], i: number) {
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
  }
  const chip =
    'ue:flex ue:h-8 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-lg ue:border ue:border-line ue:px-2.5 ue:text-body ue:text-fg ue:hover:bg-hover'
  return (
    <Card
      title={
        <>
          <Star className="ue:h-4 ue:w-4" /> {t('常用')}
        </>
      }
      aside={t('GM 页「常用」里的，在控制台点星标也会加进来')}
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
