import { useEffect, useState } from 'react'
import { useAction } from '../../api.ts'
import { h, t } from '../../host.ts'
import { patchStep, waitsForWidget } from './gt-step-patch.ts'
import type { StepDef } from './GtStepDetail.tsx'

type Via = 'inherit' | string

/**
 * 步骤详情的「执行方式」：这一步回放时等界面最多等多久（timeoutMs）、点击 / 输入用哪种方式（via）、失败了停不停（onFail）。
 * 都是 GameTest 场景里每步的现成字段，这里只是不用手改 JSON；空着 / 「跟随」时不写这个字段，按场景和运行配置走
 */
export function GtStepExec(o: {
  project: string
  root: string
  path: string
  index: number
  /** 所在槽（录制段里的步骤是 steps.N.do），不给时是顶层 steps */
  slot?: string
  def: StepDef
  locked?: boolean
  onChanged: () => void
}) {
  const { ui } = h()
  const { busy, run } = useAction()
  const { def } = o
  const timeout = typeof def.timeoutMs === 'number' ? String(def.timeoutMs / 1000) : ''
  const [wait, setWait] = useState(timeout)
  useEffect(() => setWait(timeout), [timeout])
  const off = o.locked || !!busy

  const save = (patch: Record<string, unknown>, done: string) =>
    run('exec', async () => {
      await patchStep(o, o.index, def, patch)
      h().toast.success(done)
      o.onChanged()
    })

  const saveWait = () => {
    const v = wait.trim()
    if (v === timeout) return
    if (!v) return void save({ timeoutMs: undefined }, t('等待上限改回跟随场景和运行配置'))
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) {
      h().toast.error(t('等待上限要填不小于 0 的秒数'))
      setWait(timeout)
      return
    }
    void save({ timeoutMs: Math.round(n * 1000) }, n ? t('这一步最多等 {n} 秒', { n }) : t('这一步一直等到界面出现'))
  }

  const viaOptions =
    def.action === 'click'
      ? [
          { id: 'inherit', label: t('跟随场景') },
          { id: 'code', label: t('不动鼠标') },
          { id: 'pointer', label: t('真实鼠标') },
        ]
      : def.action === 'type'
        ? [
            { id: 'inherit', label: t('跟随场景') },
            { id: 'keys', label: t('真实按键') },
            { id: 'code', label: t('直接写入') },
          ]
        : undefined
  const via: Via = typeof def.via === 'string' ? def.via : 'inherit'
  const onFail = def.onFail === 'continue' ? 'continue' : 'stop'

  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      {waitsForWidget(def) && (
        <div className="ue:flex ue:flex-col ue:gap-1">
          <div className="ue:flex ue:items-center ue:gap-2">
            <span className="ue:w-16 ue:shrink-0 ue:text-subtle">{t('等待上限')}</span>
            <ui.Input
              size="sm"
              className="ue:w-24"
              inputMode="decimal"
              placeholder={t('跟随')}
              disabled={off}
              value={wait}
              onChange={(e: { target: { value: string } }) => setWait(e.target.value)}
              onBlur={saveWait}
              onKeyDown={(e: { key: string }) => e.key === 'Enter' && saveWait()}
            />
            <span className="ue:text-subtle">{t('秒')}</span>
          </div>
          <p className="ue:pl-18 ue:text-subtle">
            {timeout === ''
              ? t('空着：按场景、运行配置、项目设置的顺序取，默认一直等')
              : timeout === '0'
                ? t('0：一直等到控件可操作，卡住时点停止')
                : t('等控件可操作最多这么久，超时这一步失败并写明卡在哪')}
          </p>
        </div>
      )}
      {viaOptions && (
        <div className="ue:flex ue:items-center ue:gap-2">
          <span className="ue:w-16 ue:shrink-0 ue:text-subtle">
            {def.action === 'click' ? t('点击方式') : t('输入方式')}
          </span>
          <ui.Segmented
            size="sm"
            value={via}
            onChange={(v: string) =>
              v !== via && void save({ via: v === 'inherit' ? undefined : v }, t('已改这一步的执行方式'))
            }
            options={viaOptions.map((x) => ({ ...x, disabled: off }))}
          />
        </div>
      )}
      <div className="ue:flex ue:items-center ue:gap-2">
        <span className="ue:w-16 ue:shrink-0 ue:text-subtle">{t('失败后')}</span>
        <ui.Segmented
          size="sm"
          value={onFail}
          onChange={(v: string) =>
            v !== onFail &&
            void save(
              { onFail: v === 'continue' ? 'continue' : undefined },
              v === 'continue' ? t('这一步失败后接着跑后面的') : t('这一步失败就停下'),
            )
          }
          options={[
            { id: 'stop', label: t('停下'), disabled: off },
            { id: 'continue', label: t('接着跑'), disabled: off },
          ]}
        />
      </div>
    </div>
  )
}
