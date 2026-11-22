import { useRef } from 'react'
import type { LuaGmBinding } from '../../../../server/lua-gm/types.ts'
import { useConnState } from '../../../conn/ConnPill.tsx'
import { useUe } from '../../../ctx.tsx'
import { t } from '../../../host.ts'
import { PANE_FILL, PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '../../../split.tsx'
import type { GmEntry, GmParam } from '../data.ts'
import type { GmData } from '../use-gm.ts'
import { CallPane } from './CallPane.tsx'
import { InstancePick } from '../../../obj-kit/InstancePick.tsx'
import { Pins } from '../../../obj-kit/Pins.tsx'
import { ObjHead } from './ObjHead.tsx'
import { MemberPane } from '../../../obj-kit/MemberPane.tsx'
import type { ObjCallState } from './use-objcall-state.tsx'

/**
 * 对象调用工作台（用户 2026-11-22 重排，效果图 designs/GM页梳理与扩展-效果图 1）：左栏是对象列表（在 GM 页的导航栏里），
 * 这里上面是对象头卡（规则、命中几个、改规则、读取…），下面「成员 · 操作」两栏：中栏选了函数右栏就是调用，选了属性就是改值，
 * 读取时属性行出勾选、右栏读值。全部复用 GameTest：调函数 = gt.step 跑一步 obj.call，读取 = gt.resolve，列函数 = gt.vars
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
  const mid = usePane('gm-objcall-members', '45%', 260)
  const midRef = useRef<HTMLElement>(null)
  const b = s.bench
  const obj = s.obj
  // 编辑器连着、游戏没开（F3）：成员按类列出来能先填参数，调用和改值要等开 PIE
  const conn = useConnState().state
  const why = canRun || (live && conn === 'editor' ? t('游戏没在运行：先开 PIE（右上角）再调，参数可以先填好') : '')
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      {!obj ? (
        <div className="ue:flex ue:flex-1 ue:items-center ue:justify-center ue:p-8 ue:text-footnote ue:text-subtle">
          {t('在左边「加对象」选一个游戏里的对象')}
        </div>
      ) : (
        <>
          <ObjHead
            obj={obj}
            hit={b.hits[obj.name]}
            live={live}
            reading={b.mode === 'get'}
            fav={s.listProps.isFav(obj.name)}
            onEdit={() => s.listProps.onEdit(obj)}
            onRead={(on) => {
              b.setMode(on ? 'get' : 'call')
              if (on) b.setTab('props')
            }}
            onFav={() => s.listProps.onFav(obj.name)}
            onRename={() => void s.listProps.onRename(obj)}
            onCopy={() => void s.listProps.onCopy(obj)}
            onDelete={() => void s.listProps.onDelete(obj)}
          />
          {obj.ref && live && <InstancePick hit={b.hits[obj.name]} only={b.only} onOnly={b.setOnly} />}
          <Pins
            project={project.id}
            game={live && conn === 'game'}
            obj={b.target ?? obj}
            pins={b.pins}
            onUnpin={b.togglePin}
          />
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
                needSig={b.fnNeedsSig}
                onSig={b.fillSig}
                picking={b.mode === 'get'}
                picked={b.picked}
                onTogglePick={b.togglePick}
                varSel={b.mode === 'set' ? b.varSel?.prop : undefined}
                onVar={b.pickVar}
                rev={b.varRev}
                pinned={b.pins}
                onTogglePin={b.togglePin}
              />
            </section>
            <SplitHandle pane={mid} paneRef={midRef} reserve={() => 360} />
            <section className={`ue:flex ue:min-h-0 ue:flex-col ${PANE_FILL}`}>
              <CallPane
                obj={b.target ?? obj}
                hit={b.hits[obj.name]}
                mode={b.mode}
                varSel={b.varSel}
                onVarChanged={b.varChanged}
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
                canRun={why}
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
        </>
      )}
    </div>
  )
}
