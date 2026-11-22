import { BookmarkPlus, ExternalLink, Play } from 'lucide-react'
import { useState } from 'react'
import type { GmObject } from '../../shared/gm/schema.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { runCall, type CallOut } from '../sections/gm/custom/run-custom.ts'
import { useGameTest } from '../sections/gm/objcall/use-objcall.ts'
import { openObjCall, saveObjToLib } from './obj-lib-actions.ts'
import { argText, argValue, SigCard } from './CallForm.tsx'
import { CallOutput } from './CallOutput.tsx'
import type { FnInfo } from './members.ts'
import { MemberPane, type MemberTab } from './MemberPane.tsx'
import { SetVarPane } from './SetVarPane.tsx'
import type { VarSel } from './VarList.tsx'

const SRC: Record<string, () => string> = { cpp: () => 'C++', bp: () => t('蓝图'), lua: () => 'Lua' }

/**
 * 对一个游戏里的对象「看成员、调函数、改值」的小工作台（测试页梳理 U4 / F1：暂停时变量里的对象、暂停条「看对象…」）。
 * 左边成员面板、右边调用卡或改值，和 GM 页对象调用同一套组件和执行路径（runCall → gt.step obj.call，改值 → SetVarPane）；
 * 底下「存进对象库」「在 GM 对象调用里打开」：要反复用、要存成 GM 时去 GM 页的完整工作台
 */
export function ObjDialog({ obj, onClose, tab: tab0 = 'fns' }: { obj: GmObject; onClose: () => void; tab?: MemberTab }) {
  const { ui } = h()
  const ue = useUe()
  const project = ue.project.id
  const { live } = useGameTest()
  const [tab, setTab] = useState<MemberTab>(tab0)
  const [fn, setFn] = useState<FnInfo>()
  const [v, setV] = useState<VarSel>()
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [out, setOut] = useState<CallOut>()
  const [running, setRunning] = useState(false)
  const [rev, setRev] = useState(0)

  const call = async () => {
    if (!fn) return
    setRunning(true)
    const args = Object.fromEntries(Object.entries(values).filter(([, x]) => x !== '' && x !== undefined))
    setOut(
      await runCall(
        project,
        {
          kind: 'call',
          obj: obj.name,
          objects: { [obj.name]: obj.ref ? { ref: obj.ref } : { src: obj.src! } },
          function: fn.name,
          args: {},
          many: 'first',
        },
        args,
        ue.target,
      ),
    )
    setRunning(false)
  }

  return (
    <ui.Modal
      open
      size="xl"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('对象 {n}', { n: obj.name })}
      description={obj.ref ? String((obj.ref as { class?: string }).class ?? '') : obj.src}
      footer={
        <div className="ue:flex ue:w-full ue:items-center ue:gap-2">
          <ui.Button variant="secondary" size="sm" onClick={() => void saveObjToLib(project, obj)}>
            <BookmarkPlus className="ue:h-3.5 ue:w-3.5" />
            {t('存进对象库')}
          </ui.Button>
          <ui.Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              if (await openObjCall(project, obj, ue.go)) onClose()
            }}
          >
            <ExternalLink className="ue:h-3.5 ue:w-3.5" />
            {t('在 GM 对象调用里打开')}
          </ui.Button>
          <ui.Button variant="secondary" className="ue:ml-auto" onClick={onClose}>
            {t('关闭')}
          </ui.Button>
        </div>
      }
    >
      <div className="ue:flex ue:h-[62vh] ue:min-h-0 ue:gap-3">
        <section className="ue:flex ue:min-h-0 ue:w-[45%] ue:flex-col ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line">
          <MemberPane
            project={project}
            obj={obj}
            live={live}
            tab={tab}
            onTab={setTab}
            fn={fn?.name}
            onFn={(f) => {
              setFn(f)
              setV(undefined)
              setValues({})
              setOut(undefined)
            }}
            varSel={v?.prop}
            onVar={(x) => {
              setV(x)
              setFn(undefined)
            }}
            rev={rev}
          />
        </section>
        <section className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col ue:gap-3 ue:overflow-y-auto">
          {fn ? (
            <>
              <SigCard sig={{ name: fn.name, sig: fn.sig, src: SRC[fn.src]?.() }} />
              {fn.params.length ? (
                fn.params.map((p) => (
                  <label
                    key={p.name}
                    className="ue:grid ue:grid-cols-[minmax(80px,32%)_minmax(0,1fr)] ue:items-center ue:gap-2"
                  >
                    <span className="ue:min-w-0 ue:truncate ue:text-footnote" title={`${p.name}: ${p.type}`}>
                      <span className="ue:font-mono ue:text-fg">{p.name}</span>{' '}
                      <span className="ue:text-caption ue:text-subtle">{p.type}</span>
                    </span>
                    <ui.Input
                      size="sm"
                      spellCheck={false}
                      className="ue:w-full ue:font-mono"
                      placeholder={p.obj ? t('对象路径') : p.type}
                      value={argText(values[p.name])}
                      onChange={(e: { target: { value: string } }) =>
                        setValues((m) => ({ ...m, [p.name]: argValue(p.type, e.target.value) }))
                      }
                    />
                  </label>
                ))
              ) : (
                <p className="ue:text-footnote ue:text-subtle">{t('没有参数')}</p>
              )}
              <div>
                <ui.Button size="sm" disabled={running || !live} onClick={() => void call()}>
                  <Play className="ue:h-3.5 ue:w-3.5" />
                  {running ? t('调用中…') : t('调用')}
                </ui.Button>
              </div>
              <CallOutput out={out} args={values} />
            </>
          ) : v ? (
            <SetVarPane
              obj={obj}
              v={v}
              live={live}
              canRun={live ? '' : t('UE 没连上')}
              onChanged={(r) => r.ok && setRev((n) => n + 1)}
            />
          ) : (
            <p className="ue:flex ue:flex-1 ue:items-center ue:justify-center ue:p-6 ue:text-footnote ue:text-subtle">
              {t('在左边选一个函数调用，或选一个属性改值')}
            </p>
          )}
        </section>
      </div>
    </ui.Modal>
  )
}
