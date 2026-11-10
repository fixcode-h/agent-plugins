import { Camera, Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { op, useAction } from './api.ts'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'
import { ErrorText, useTargetInfo, worldLabel } from './ui.tsx'

interface Shot {
  png: string
  width: number
  height: number
  world: string
}

/** 截视口浮层：左栏底部随时能点（以前藏在监视页底下），打开就截一张目标世界的视口，可以重截、存成文件 */
export function ShotDialog({ onClose }: { onClose: () => void }) {
  const { project, target } = useUe()
  const { inst, world } = useTargetInfo()
  const { ui } = h()
  const { busy, run } = useAction()
  const [shot, setShot] = useState<Shot>()
  const [error, setError] = useState('')
  const capture = () =>
    run('shot', async () => {
      setError('')
      try {
        setShot(await op<Shot>(project.id, 'screenshot', { maxWidth: 1600 }, target, 20000))
      } catch (e) {
        setError((e as Error).message)
      }
    })
  useEffect(() => {
    if (inst) void capture()
    // 打开时截一次；换目标后点「重新截」
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const name = `${project.uname}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`
  return (
    <ui.Modal
      open
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('截视口')}
      size="lg"
      footer={
        <>
          {shot && (
            <a
              href={`data:image/png;base64,${shot.png}`}
              download={name}
              className="ue:mr-auto ue:inline-flex ue:h-8 ue:items-center ue:gap-1.5 ue:rounded-lg ue:px-2.5 ue:text-body ue:text-muted ue:hover:bg-hover ue:hover:text-fg"
            >
              <Download className="ue:h-3.5 ue:w-3.5" /> {t('存成文件')}
            </a>
          )}
          <ui.Button variant="secondary" onClick={onClose}>
            {t('关闭')}
          </ui.Button>
          <ui.Button disabled={!inst || busy === 'shot'} onClick={() => void capture()}>
            <Camera className="ue:h-3.5 ue:w-3.5" /> {shot ? t('重新截') : t('截视口')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-2">
        <p className="ue:text-footnote ue:text-subtle">
          {inst
            ? t('截的是目标世界：{w}', { w: world ? worldLabel(world) : t('默认世界') })
            : t('UE 没在运行，没有视口可截')}
        </p>
        <ErrorText>{error}</ErrorText>
        {busy === 'shot' && !shot && <p className="ue:text-footnote ue:text-subtle">{t('截图中…')}</p>}
        {shot && (
          <figure className="ue:flex ue:flex-col ue:gap-1">
            <img
              src={`data:image/png;base64,${shot.png}`}
              alt={t('视口截图')}
              className="ue:block ue:max-h-[60vh] ue:w-full ue:rounded-lg ue:border ue:border-line ue:object-contain"
            />
            <figcaption className="ue:text-caption ue:text-subtle">
              {shot.width}×{shot.height} · {shot.world}
            </figcaption>
          </figure>
        )}
      </div>
    </ui.Modal>
  )
}
