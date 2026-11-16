import { Activity, Bug, FileText, Save, Sparkles, SquareTerminal, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { h } from '../../host.ts'
import { JumpFoot, JumpGroup, JumpRow } from '../../jump/parts.tsx'
import { JumpEntry } from '../../Side.tsx'
import { AttentionRow, Readout, TimelineRow } from './parts.tsx'

/**
 * 设置 →「组件」里的示例：概览的读数、「需要你处理」一行、时间线一行，跳转弹窗的分组和行、左栏的跳转入口。
 * 用假数据，不碰 UE
 */
export function OverviewSpecimen() {
  const { toast } = h()
  const [sel, setSel] = useState(0)
  const noop = () => toast.success('demo')
  return (
    <div className="ue:flex ue:w-full ue:flex-col ue:gap-4">
      <div className="ue:grid ue:gap-px ue:overflow-hidden ue:rounded-lg ue:border ue:border-line ue:bg-line ue:sm:grid-cols-3">
        <Readout icon={Save} title="改了没保存" value={3} unit="个资源" tone="warn" onClick={noop} />
        <Readout icon={FileText} title="本次日志" value={12} unit="个错误 · 48 个警告" tone="danger" onClick={noop} />
        <Readout icon={Activity} title="帧时间" value="16.4" unit="ms · Game 9.1 · GPU 14.8" onClick={noop} />
      </div>
      <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line ue:overflow-hidden ue:rounded-lg ue:border ue:border-line ue:bg-card">
        <AttentionRow
          item={{
            key: 'crash',
            tone: 'danger',
            icon: Bug,
            title: 'UE 崩溃了 · 10:42',
            detail: 'Access violation · BagComponent::RemoveItem',
            actions: [
              { label: '看崩溃记录', run: noop },
              { label: '交给 Agent 诊断', icon: Sparkles, primary: true, run: noop },
            ],
          }}
        />
        <AttentionRow
          item={{
            key: 'dirty',
            tone: 'warn',
            icon: Save,
            title: '3 个资源改了没保存',
            detail: 'WBP_Bag、DT_Item、BP_Hero',
            actions: [{ label: '去保存', run: noop }],
          }}
        />
      </ul>
      <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line ue:overflow-hidden ue:rounded-lg ue:border ue:border-line ue:bg-card">
        <TimelineRow time="10:42:03" tag="错误" tone="danger" text="LogScript: Accessed None 'SlotWidget'" />
        <TimelineRow time="10:41:40" tag="Agent" tone="accent" text="row.set DT_Item 3 行（Price、StackMax）" />
      </ul>
      <div className="ue:flex ue:flex-col ue:gap-2 ue:rounded-lg ue:border ue:border-line ue:bg-card ue:p-3">
        <JumpGroup title="本页已有的列表里匹配">
          <JumpRow
            opt={{ icon: Wand2, label: 'GM.AddItem', detail: 'itemId, count', hint: 'GM · 背包', run: noop }}
            on={sel === 0}
            onHover={() => setSel(0)}
          />
          <JumpRow
            opt={{ icon: SquareTerminal, label: 'Bag.ShowDebug 1', hint: '控制台收藏', run: noop }}
            on={sel === 1}
            onHover={() => setSel(1)}
          />
        </JumpGroup>
        <JumpFoot chat />
      </div>
      <div className="ue:max-w-60">
        <JumpEntry onClick={noop} />
      </div>
    </div>
  )
}
