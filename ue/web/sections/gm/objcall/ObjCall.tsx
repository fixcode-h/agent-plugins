import { Crosshair } from 'lucide-react'
import { useRef } from 'react'
import type { LuaGmBinding } from '../../../../server/lua-gm/types.ts'
import { useUe } from '../../../ctx.tsx'
import { t } from '../../../host.ts'
import { PANE_FILL, PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '../../../split.tsx'
import type { GmEntry, GmParam } from '../data.ts'
import type { GmData } from '../use-gm.ts'
import { CallPane } from './CallPane.tsx'
import { MemberPane } from './MemberPane.tsx'
import type { ObjCallState } from './use-objcall-state.tsx'

/**
 * 对象调用工作台（规格第 7 节、效果图 2）：左栏是对象列表（在 GM 页的导航栏里），这里是中栏（方法 · 属性 · Lua · 运行状态）
 * 和右栏（调函数 / 取对象）。全部复用 GameTest：调函数 = gt.step 跑一步 obj.call，取对象 = gt.resolve，列函数 = gt.vars
 */
export function ObjCall({
  s,
  d,
  live,
  canRun,
  onEditBinding,
}: {
  s: ObjCallState
  d: GmData
  live: boolean
  canRun: string
  onEditBinding: (entry: GmEntry, p: GmParam, current?: LuaGmBinding) => void
}) {
  const { project } = useUe()
  const mid = usePane('gm-objcall-members', '42%', 260)
  const midRef = useRef<HTMLElement>(null)
  const b = s.bench
  const obj = s.obj
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <header className="ue:flex ue:min-h-10 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-1.5">
        <Crosshair className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-accent" />
        <span className="ue:text-body ue:font-medium ue:text-fg">{t('对象调用')}</span>
        <span className="ue:min-w-0 ue:truncate ue:text-caption ue:text-subtle">
          {t('按匹配规则找到游戏里的对象，调它的函数、看它的属性；对象能当函数参数传，常用的保存成 GM')}
        </span>
      </header>
      {!obj ? (
        <div className="ue:flex ue:flex-1 ue:items-center ue:justify-center ue:p-8 ue:text-footnote ue:text-subtle">
          {t('在左边「加对象」选一个游戏里的对象')}
        </div>
      ) : (
        <div className={SPLIT_ROW}>
          <section
            ref={midRef}
            style={mid.style('60%')}
            className={`ue:flex ue:min-h-80 ue:flex-col ue:lg:min-h-0 ${PANE_FIXED}`}
          >
            <MemberPane
              project={project.id}
              obj={obj}
              live={live}
              tab={b.tab}
              onTab={b.setTab}
              fn={b.fn?.name}
              onFn={b.pickFn}
              picking={b.mode === 'get'}
              picked={b.picked}
              onTogglePick={b.togglePick}
            />
          </section>
          <SplitHandle pane={mid} paneRef={midRef} reserve={() => 360} />
          <section className={`ue:flex ue:min-h-0 ue:flex-col ${PANE_FILL}`}>
            <CallPane
              obj={obj}
              hit={b.hits[obj.name]}
              mode={b.mode}
              onMode={b.setMode}
              fn={b.fn}
              values={b.values}
              onValue={b.setValue}
              many={b.many}
              onMany={b.setMany}
              picked={b.picked}
              onUnpick={b.togglePick}
              objects={d.gm.objects}
              hits={b.hits}
              live={live}
              running={b.running}
              canRun={canRun}
              out={b.out}
              sentArgs={b.sentArgs}
              onRun={b.run}
              onSave={b.save}
              onNewRule={b.onNewRule}
              gm={d.gm}
              config={d.lua.data?.config}
              onEditBinding={onEditBinding}
            />
          </section>
        </div>
      )}
    </div>
  )
}
