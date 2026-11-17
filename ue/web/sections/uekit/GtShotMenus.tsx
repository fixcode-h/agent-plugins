import { ImageOff, ScanText } from 'lucide-react'
import { useState } from 'react'
import { ppost, useLoad } from '../../api.ts'
import { h, t } from '../../host.ts'
import { Confirm, fmtSize } from '../../ui.tsx'
import { ocrScenario } from './gt-ocr.ts'
import type { Scenario } from './GtMenus.tsx'

/**
 * 录制截图的菜单项（GameTest 1.3.1 起录制时截图，存在项目 Saved/GameTest/shots）：
 * 场景右键「识别截图文字」「删除这个场景的录制截图」，左栏底部显示占用并能一键删全部。
 * 删除只删图片，场景里的 hint.shot 留着（步骤详情显示「截图已删」），回放不受影响。
 */
export function useShotMenus(o: { project: string; root: string; reload: () => void }) {
  const { toast, ui } = h()
  const size = useLoad(() => ppost<{ size: number }>(o.project, 'ext/gt/shots', { action: 'size' }), [o.project])
  const [ask, setAsk] = useState<{ scope: 'all' } | { scope: 'scenario'; s: Scenario }>()

  const recognize = async (s: Scenario) => {
    try {
      const r = await ocrScenario(o.project, o.root, s.relativePath, true)
      if (!r.installed) toast.error(t('OCR 还没装：到「设置 → 插件 → UE」下载'))
      else if (!r.total) toast.success(t('这个场景没有带红框的录制截图'))
      else {
        toast.success(t('认了 {total} 张截图，{n} 步认出了按钮文字', { total: r.total, n: r.named }))
        o.reload()
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const remove = async () => {
    const a = ask
    setAsk(undefined)
    if (!a) return
    try {
      const r = await ppost<{ size: number }>(o.project, 'ext/gt/shots', {
        scope: a.scope,
        ...(a.scope === 'scenario' ? { root: o.root, path: a.s.relativePath } : {}),
      })
      toast.success(t('删掉了 {size} 录制截图', { size: fmtSize(r.size) }))
      void size.reload()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  /** 场景右键菜单里的两项 */
  const items = (s: Scenario) => [
    { label: t('识别截图文字'), icon: ScanText, hint: t('OCR'), onClick: () => void recognize(s) },
    { label: t('删除录制截图…'), icon: ImageOff, onClick: () => setAsk({ scope: 'scenario', s }) },
  ]

  const footer = size.data?.size ? (
    <span className="ue:flex ue:items-center ue:gap-1.5">
      {t('录制截图 {size}', { size: fmtSize(size.data.size) })}
      <ui.Button size="xs" variant="ghost" onClick={() => setAsk({ scope: 'all' })}>
        {t('全部删除')}
      </ui.Button>
    </span>
  ) : null

  const dialog = (
    <Confirm
      open={!!ask}
      danger
      title={t('删除录制截图')}
      okText={t('删除')}
      onOk={() => void remove()}
      onCancel={() => setAsk(undefined)}
    >
      {ask?.scope === 'all'
        ? t(
            '删除这个项目的全部录制截图（Saved/GameTest/shots，{size}）？场景不动，回放不受影响，只是步骤详情里看不到录制时的截图、AI 整理也没图可看。',
            {
              size: fmtSize(size.data?.size ?? 0),
            },
          )
        : t('删除「{name}」录制时截的图？场景不动，回放不受影响。', { name: ask?.s.name ?? '' })}
    </Confirm>
  )

  return { items, footer, dialog, refresh: () => void size.reload() }
}
