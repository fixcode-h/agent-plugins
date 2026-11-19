import { useState } from 'react'
import { insert, type GtScript } from '../../../../shared/gt-script/index.ts'
import { GtFlowView } from './GtFlowView.tsx'
import { BpView } from './bp/BpView.tsx'
import { emptyRun, type FlowRunState } from './run-state.ts'

/**
 * 设置 →「组件」里 GameTest 流程图的示例（效果图 1、6 的「每日福利」）：假数据，不连 UE。
 * 能点 + 插、能折叠展开；运行状态是摆好的一刻（循环第 3 轮、正在等奖励弹窗、守护触发过几次，其中一条超过 999）
 */
const DOC: GtScript = {
  kind: 'gametest-scenario',
  schemaVersion: 3,
  name: '每日福利',
  guards: [
    {
      id: 'g1',
      name: '新手引导出现',
      when: { target: 'WBP_Guide:.', onScreen: true },
      do: [{ action: 'call', script: 'common/翻完引导' }],
    },
    {
      id: 'g2',
      name: '断线重连弹出',
      when: { target: 'WBP_Reconnect:.', onScreen: true },
      do: [{ action: 'console', command: 'gm.Reconnect' }],
    },
    {
      id: 'g3',
      name: '登录公告出现',
      when: { target: 'WBP_Notice:.', onScreen: true },
      do: [{ action: 'widget.close', target: 'WBP_Notice:.' }],
    },
  ],
  steps: [
    { id: 's1', action: 'call', script: 'common/登录并进主城', with: { account: '$account' } },
    {
      id: 'g_open',
      action: 'group',
      name: '打开福利',
      do: [
        { id: 's2', action: 'click', target: 'WBP_Main:Root/BtnWelfare' },
        { id: 's3', action: 'click', target: 'WBP_Welfare:Root/TabDaily' },
        { id: 's4', action: 'wait', target: 'WBP_Welfare:Root/DailyList', visible: true },
      ],
    },
    {
      id: 'loop1',
      action: 'loop',
      each: 'WBP_Welfare:Root/DailyList',
      as: 'item',
      max: 10,
      do: [
        {
          id: 'if1',
          action: 'if',
          // 两项条件：蓝图画布的节点里一行一项列出来（「且」写在行首）
          cond: {
            all: [
              { target: '$item>BtnClaim', textLike: '领取' },
              { target: '$item>BtnClaim', enabled: true },
            ],
          },
          then: [
            { id: 's5', action: 'click', target: '$item>BtnClaim' },
            { id: 's6', action: 'wait', target: 'WBP_RewardPopup:.', visible: true },
            { id: 's7', action: 'click', target: 'WBP_RewardPopup:Root/BtnOk' },
          ],
          else: [{ id: 's8', action: 'set', var: 'skipped', value: '=$skipped + 1' }],
        },
      ],
    },
    { id: 's9', action: 'assert', target: 'WBP_Main:Root/BtnWelfare>Dot', visible: false },
  ],
}

const RUN: FlowRunState = {
  ...emptyRun(),
  runId: 'demo',
  active: true,
  at: 's6',
  steps: {
    s1: { status: 'passed', ms: 18200, runs: 1 },
    g_open: { status: 'passed', ms: 2600, runs: 1 },
    s2: { status: 'passed' },
    s3: { status: 'passed' },
    s4: { status: 'passed' },
    loop1: { status: 'running', iter: 3, runs: 1 },
    if1: { status: 'passed', runs: 3 },
    s5: { status: 'passed', ms: 320, runs: 2 },
    s6: { status: 'running', runs: 2 },
  },
  guards: { g1: 1, g2: 12, g3: 1200 },
}

export function FlowSpecimen() {
  const [doc, setDoc] = useState(DOC)
  const [sel, setSel] = useState<string | undefined>('loop1')
  return (
    <div className="ue:h-[460px] ue:w-full ue:overflow-hidden ue:rounded-xl ue:bg-bg">
      <GtFlowView
        doc={doc}
        onChange={(d) => setDoc(d)}
        selected={sel}
        onSelect={(s) => setSel(s?.key)}
        run={RUN}
        // 示例里点 + 直接插一步「等一下」，真实的编辑页弹插入菜单
        onPickInsert={(at) => setDoc((d) => insert(d, at.slot, at.index, [{ action: 'wait', ms: 500 }])?.doc ?? d)}
      />
    </div>
  )
}

/**
 * 设置 →「组件」里 GameTest 蓝图画布的示例：同一份「每日福利」画成蓝图节点，
 * 看节点卡片、内容区（多项条件一行一项）、出口行、圆点引脚；调「流程图节点」「流程图引脚」马上能看到变化
 */
export function BpSpecimen() {
  const [doc, setDoc] = useState(DOC)
  const [sel, setSel] = useState<string | undefined>('loop1')
  return (
    <div className="ue:h-[520px] ue:w-full ue:overflow-hidden ue:rounded-xl ue:bg-bg">
      <BpView doc={doc} onChange={(d) => setDoc(d)} selected={sel} onSelect={(s) => setSel(s?.key)} run={RUN} />
    </div>
  )
}
