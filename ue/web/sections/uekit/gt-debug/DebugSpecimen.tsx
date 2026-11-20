import type { GtScript } from '../../../../shared/gt-script/index.ts'
import { EditContext } from '../gt-edit/ctx.ts'
import { RunBanner } from '../gt-edit/RunBanner.tsx'
import { emptyRun } from '../gt-flow/run-state.ts'
import { RunControls } from './RunControls.tsx'
import { RunPanel } from './RunPanel.tsx'
import type { DebugApi } from './use-debug.ts'

/**
 * 设置 →「组件」里调试和运行面板的示例（效果图 6）：停在断点上的运行横条 + 右栏运行记录、此刻的变量。
 * 假数据、不连 UE，按钮点了没反应
 */
const DOC: GtScript = {
  schemaVersion: 4,
  name: '每日福利',
  params: { account: { default: 'qa_01', type: 'string' } },
  vars: { skipped: 0 },
  guards: [
    {
      id: 'g1',
      name: '新手引导出现',
      when: { obj: { class: 'WBP_Guide_C' }, prop: ':onScreen', op: 'is', value: true },
      do: [],
    },
  ],
  steps: [
    { id: 's1', action: 'call', script: 'common/登录并进主城' },
    {
      id: 'loop1',
      action: 'loop',
      each: { obj: { class: 'WBP_Welfare_C' }, part: 'DailyList' },
      as: 'item',
      do: [
        { id: 's2', action: 'click', target: { obj: '$item', part: 'BtnClaim' }, note: '点 领取' },
        {
          id: 's3',
          action: 'wait',
          until: 'cond',
          cond: { obj: { class: 'WBP_RewardPopup_C' }, prop: ':onScreen', op: 'is', value: true },
          note: '等到 奖励弹窗',
        },
      ],
    },
  ],
}

const noop = () => undefined

const DEBUG: DebugApi = {
  flow: { ...emptyRun(), runId: 'demo', active: true, paused: true, at: 's3' },
  log: {
    runId: 'demo',
    entries: [
      { n: 0, kind: 'step', key: 's1', depth: 0, status: 'passed', ms: 18200, at: 2000 },
      { n: 1, kind: 'step', key: 'loop1', depth: 0, status: 'running', at: 23000 },
      { n: 2, kind: 'iter', key: 'loop1', depth: 0, iter: 1, at: 29000 },
      { n: 3, kind: 'guard', key: 'g1', depth: 1, status: 'passed', ms: 2100, at: 30000 },
      { n: 4, kind: 'step', key: 's2', depth: 1, status: 'passed', ms: 400, at: 32000 },
      { n: 5, kind: 'pause', key: 's3', depth: 1, at: 33000 },
    ],
  },
  vars: { item: 'DailyList[2] · cfgId=5', skipped: 1, account: 'qa_01' },
  breakpoints: ['s3'],
  run: noop,
  pending: undefined,
  confirmParams: noop,
  cancelParams: noop,
  pause: noop,
  resume: noop,
  step: noop,
}

export function DebugSpecimen() {
  return (
    <EditContext.Provider value={{ project: '', root: '', live: false, doc: DOC, apis: [], aliases: [] }}>
      <div className="ue:flex ue:flex-col ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line">
        <RunBanner run={{ done: 22, planned: 40, failed: 0, onStop: noop }} paused>
          <RunControls debug={DEBUG} />
        </RunBanner>
        <div className="ue:ml-auto ue:h-[420px] ue:w-[380px] ue:border-l ue:border-line">
          <RunPanel project="" doc={DOC} debug={DEBUG} onSelect={noop} onClose={noop} />
        </div>
      </div>
    </EditContext.Provider>
  )
}
