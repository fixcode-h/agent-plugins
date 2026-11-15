import { FileJson, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { op, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useExtEvents } from './ListCol.tsx'

/**
 * 资源页右上角的「导出到 JSON」：项目装了 AssetForge 才出现，导出走 AssetForge 的 forge.export（编辑器没开时也走后台编辑器）。
 * 已经有配置的资产按钮变成「更新 JSON」，旁边能跳到 AssetForge 页看这份配置；AssetForge 不认的类型不显示按钮。
 */
interface Describe {
  managed?: boolean
  exportable?: boolean
  entry?: { config?: string; asset?: string }
}

export function ForgeExport({ asset }: { asset: string }) {
  const { project, state, go } = useUe()
  const { ui, toast } = h()
  const installed = !!state?.extensions?.some((x) => x.name === 'AssetForge')
  // 资源页传的是对象路径（/Game/A/B.B），AssetForge 认包路径
  const pkg = asset.split('.')[0]
  const desc = useLoad(
    () => (installed && pkg ? op<Describe>(project.id, 'forge.describe', { asset: pkg }) : Promise.resolve(undefined)),
    [project.id, pkg, installed],
  )
  const [job, setJob] = useState('')
  useExtEvents(project.id, (e) => {
    if (e.event !== 'forge.job' || !job || e.id !== job || e.phase !== 'finished') return
    setJob('')
    if (e.status === 'done') toast.success(t('已导出到 JSON'))
    else toast.error(t('导出没成功：去 AssetForge 页看原因'))
    desc.reload()
  })
  if (!installed || !desc.data || !(desc.data.managed || desc.data.exportable)) return null
  const managed = !!desc.data.managed
  const exportNow = () =>
    op<{ job: string }>(project.id, 'forge.export', { assets: [pkg] }).then(
      (r) => setJob(r.job),
      (e: Error) => toast.error(e.message),
    )
  return (
    <>
      {managed && (
        <ui.Button size="sm" variant="ghost" onClick={() => go('assetforge', desc.data?.entry?.asset ?? pkg)}>
          {t('在 AssetForge 中查看')}
        </ui.Button>
      )}
      <ui.Button
        size="sm"
        variant="secondary"
        disabled={!!job}
        title={t('用 AssetForge 把资产当前的状态写成 JSON 配置，放在项目文档目录下')}
        onClick={() => void exportNow()}
      >
        {job ? <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" /> : <FileJson className="ue:h-3.5 ue:w-3.5" />}
        {managed ? t('更新 JSON') : t('导出到 JSON')}
      </ui.Button>
    </>
  )
}
