import { useState } from 'react'
import { type EditResult, type GtPath, type GtScript } from '../../../../shared/gt-script/index.ts'
import { EditContext } from '../gt-edit/ctx.ts'
import { useScope } from '../gt-edit/use-scope.ts'
import { FlowEditView } from './FlowEditView.tsx'

/**
 * 设置 →「组件」里 GameTest 流程图的示例（效果图 1、6 的「每日福利」）：假数据，不连 UE。
 * 双击块进到里面（子图），顶上一行路径点了回去；能框选、拖线；运行状态是摆好的一刻（循环第 3 轮、正在等奖励弹窗、守护触发过几次，其中一条超过 999）
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

/** 摆好的一刻：循环第 3 轮、正在等奖励弹窗（编辑页外壳给视图的简版运行状态） */
const RUN_VIEW = {
  at: 's6',
  status: { s1: 'ok', g_open: 'ok', s2: 'ok', s3: 'ok', s4: 'ok', loop1: 'run', if1: 'ok', s5: 'ok', s6: 'run' },
} as const

export function FlowSpecimen() {
  const [doc, setDoc] = useState(DOC)
  const [sel, setSel] = useState<GtPath[]>([['steps', 2]])
  const scope = useScope(doc, sel, setSel)
  const apply = (r: EditResult | GtScript | undefined) => {
    if (!r) return false
    if ('path' in r && Array.isArray(r.path) && 'doc' in r) {
      setDoc((r as EditResult).doc)
      setSel([(r as EditResult).path])
    } else setDoc(r as GtScript)
    return true
  }
  return (
    <EditContext.Provider value={{ project: '', root: '', live: false, doc, apis: [], aliases: [] }}>
      <div className="ue:flex ue:h-[460px] ue:w-full ue:flex-col ue:overflow-hidden ue:rounded-xl ue:bg-bg">
        {/* 和编辑页顶栏同一种面包屑：进到块里面一层多一级，点了回去 */}
        <nav className="ue:flex ue:items-center ue:gap-1.5 ue:border-b ue:border-line ue:px-3 ue:py-1.5 ue:font-mono ue:text-footnote ue:text-muted">
          <button type="button" className="ue:cursor-pointer ue:hover:text-fg" onClick={scope.root}>
            {doc.name}
          </button>
          {scope.crumbs.map((c, i) => (
            <span key={i} className="ue:flex ue:items-center ue:gap-1.5">
              <span className="ue:text-subtle">/</span>
              <button type="button" className="ue:cursor-pointer ue:hover:text-fg" onClick={c.onClick}>
                {c.label}
              </button>
            </span>
          ))}
        </nav>
        <FlowEditView
          doc={doc}
          onChange={apply}
          selected={sel}
          onSelect={setSel}
          run={RUN_VIEW}
          scope={scope.path}
          onEnter={(p, st) => st.action !== 'call' && scope.enter(p, st)}
          onLeave={scope.leave}
        />
      </div>
    </EditContext.Provider>
  )
}
