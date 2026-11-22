import { t } from '../../host.ts'
import { GtBatchBar, type GtBatch } from './GtBatch.tsx'
import { GtEvidence } from './GtEvidence.tsx'
import { GtRecordShot } from './GtRecordShot.tsx'
import { GtHistoryBar } from './GtHistoryBar.tsx'
import { GtStepHistory } from './GtStepHistory.tsx'
import { GtStepExec } from './GtStepExec.tsx'

/**
 * 设置 →「组件」里 GameTest 页共用部件的示例：场景列表上的历史条、批量运行条、步骤的最近几次、执行方式、失败证据、录制截图。
 * 全是假数据，不连 UE（设置页里没有 UE 页的上下文），所以证据的截图不显示、「看前后日志」是灰的
 */
const BATCH: GtBatch = {
  id: 'batch-7',
  label: 'tag:smoke',
  active: true,
  total: 4,
  current: 2,
  passed: 1,
  failed: 1,
  items: [
    { scenario: 'smoke/login.json', name: '登录', status: 'passed', durationMs: 8400 },
    {
      scenario: 'smoke/shop.json',
      name: '商店',
      status: 'failed',
      failedStep: 6,
      message: '等待超时：WBP_Shop:BtnBuy 被挡住',
      durationMs: 12100,
    },
    { scenario: 'smoke/bag.json', name: '背包', status: 'running' },
    { scenario: 'smoke/mail.json', status: 'pending' },
  ],
}

export function GtSpecimen() {
  const noop = () => undefined
  return (
    <div className="ue:flex ue:w-full ue:flex-col ue:gap-5">
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-4 ue:text-footnote ue:text-subtle">
        <span className="ue:flex ue:items-center ue:gap-2">
          <GtHistoryBar marks="ppppppppfp" /> {t('最近 10 次')}
        </span>
        <span className="ue:flex ue:items-center ue:gap-2">
          <GtHistoryBar marks="ffp" /> {t('只跑过 3 次')}
        </span>
        <span className="ue:flex ue:items-center ue:gap-2">
          <GtHistoryBar /> {t('还没跑过')}
        </span>
      </div>
      <div className="ue:grid ue:gap-4 ue:rounded-lg ue:border ue:border-line ue:p-4 ue:text-footnote ue:md:grid-cols-2">
        <GtStepHistory
          row={{ key: 'steps.5', slot: 'steps', i: 5 }}
          revision={3}
          runs={[
            {
              runId: 'r9',
              succeeded: false,
              failedStep: 6,
              message: '等待超时：WBP_Shop:BtnBuy 被挡住',
              startedAtUtc: '2026-11-16T12:03:01Z',
              durationMs: 12100,
              revision: 3,
            },
            { runId: 'r8', succeeded: true },
            { runId: 'r7', succeeded: false, failedStep: 2 },
            {
              runId: 'r6',
              succeeded: false,
              failedStep: 6,
              message: '没找到 WBP_Shop:BtnBuy',
              startedAtUtc: '2026-11-15T09:40:00Z',
              revision: 2,
            },
            { runId: 'r5', succeeded: true },
          ]}
        />
        <GtStepExec
          project=""
          root=""
          path=""
          index={0}
          locked
          def={{ action: 'click', target: 'WBP_Shop:BtnBuy', via: 'pointer', timeoutMs: 15000 }}
          onChanged={noop}
        />
      </div>
      <div className="ue:overflow-hidden ue:rounded-lg ue:border ue:border-line">
        <GtBatchBar batch={BATCH} onStop={noop} />
      </div>
      <div className="ue:overflow-hidden ue:rounded-lg ue:border ue:border-line">
        <GtEvidence
          e={{
            dir: 'Saved/GameTest/商店-20261116-120301/failures/step-06',
            log: 'Saved/GameTest/商店-20261116-120301/failures/step-06/log.txt',
            widgets: 'Saved/GameTest/商店-20261116-120301/failures/step-06/widgets.json',
            screens: 3,
            selectorError: '没找到 WBP_Shop:BtnBuy。候选：WBP_Shop:Root/Panel/BtnBuyNow、WBP_Shop:Root/Panel/BtnBack',
          }}
          onAgent={noop}
        />
      </div>
      <div className="ue:max-w-md ue:rounded-lg ue:border ue:border-line ue:p-4 ue:text-footnote">
        <GtRecordShot hint={{ shot: 'shot.svg', ocr: '桌面摆件2', opened: ['WBP_Decor_C'] }} imageUrl={() => SHOT} />
      </div>
    </div>
  )
}

/** 录制截图的示例图：按钮描红框、按下处画十字，和 GameTest 1.3.2 截的样子一样（示例数据，不翻译） */
const SHOT = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="120"><rect width="260" height="120" fill="#2b2f36"/>' +
    '<text x="8" y="20" fill="#c9ced6" font-size="13">背包 (12/40)</text>' +
    '<rect x="70" y="40" width="120" height="40" rx="6" fill="#4a5568"/>' +
    '<text x="130" y="66" fill="#fff" font-size="16" text-anchor="middle">桌面摆件2</text>' +
    '<rect x="69" y="39" width="122" height="42" fill="none" stroke="#000" stroke-width="1"/>' +
    '<rect x="70" y="40" width="120" height="40" fill="none" stroke="#ff3b30" stroke-width="2"/>' +
    '<path d="M150 54v12M144 60h12" stroke="#ff3b30" stroke-width="2"/></svg>',
)}`
