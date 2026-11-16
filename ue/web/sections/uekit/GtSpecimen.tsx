import { t } from '../../host.ts'
import { GtBatchBar, type GtBatch } from './GtBatch.tsx'
import { GtEvidence } from './GtEvidence.tsx'
import { GtHistoryBar } from './GtHistoryBar.tsx'

/**
 * 设置 →「组件」里 GameTest 页共用部件的示例：场景列表上的历史条、批量运行条、步骤详情里的失败证据。
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
    </div>
  )
}
