import { AudioLines, ExternalLink, Music, Waves } from 'lucide-react'
import { useMemo, useState } from 'react'
import { op, useAction } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { Card, ErrorText } from '../../../ui.tsx'
import { DetailsCard } from '../preview/DetailsCard.tsx'
import { restTags } from '../preview/model.ts'
import { AssetHead, InfoCard, InfoRows, PickRow, SideCard, Why } from '../preview/parts.tsx'
import { useAssetDesc, usePreviewView, usePropMap } from '../preview/use-asset.ts'
import { LayoutShell } from '../shell/LayoutShell.tsx'
import type { LayoutProps } from '../types.ts'
import { audioFacts, soundNodes } from './model.ts'

const FACT_LABEL: Record<string, () => string> = {
  duration: () => t('时长'),
  rate: () => t('采样率'),
  channels: () => t('声道'),
  quality: () => t('压缩质量'),
  loop: () => t('循环'),
}

/**
 * 音频（设计稿第 3 节、效果图 B7）：中间声音信息（时长、采样率、声道，来自属性和注册表标签）；
 * 波形、频谱要 UELink 导出解码后的 PCM（还没有接口），不画假的波形，写明原因，试听去 UE 里。
 * SoundCue 左边列声音节点，点一个看它的细节；右边细节
 */
export function AudioLayout(p: LayoutProps) {
  const { path, layout, onOpen, hint, marks } = p
  const [view, setView] = usePreviewView()
  const d = useAssetDesc(path)
  const props = usePropMap(path)
  const [picked, setPicked] = useState({ path, sub: '' })
  const sub = picked.path === path ? picked.sub : ''
  const nodes = useMemo(() => soundNodes(d.desc?.subobjects), [d.desc])
  const facts = audioFacts(d.desc?.tags, props.map)
  return (
    <LayoutShell
      layout={layout}
      head={
        <AssetHead
          path={path}
          icon={AudioLines}
          cls={d.desc?.class ?? 'SoundWave'}
          view={view}
          onView={setView}
          previewLabel={t('声音')}
        />
      }
      regions={{
        nodes: nodes.length ? (
          <SideCard title={t('声音节点')} icon={Music} aside={nodes.length}>
            {nodes.map((n) => (
              <PickRow
                key={n.path}
                icon={Music}
                label={n.type}
                aside={n.name}
                title={n.path}
                on={sub === n.path}
                onClick={() => setPicked({ path, sub: n.path })}
              />
            ))}
            <Why>{t('节点之间的连线 UELink 还导不出来，这里只列节点。')}</Why>
          </SideCard>
        ) : null,
        details: (
          <DetailsCard
            path={path}
            sub={sub}
            onBack={() => setPicked({ path, sub: '' })}
            onOpen={onOpen}
            hint={hint}
            marks={marks}
          />
        ),
      }}
      center={
        view === 'info' ? (
          <InfoCard path={path} onOpen={onOpen} />
        ) : (
          <SoundInfo path={path} facts={facts} tags={d.desc?.tags} error={d.error || props.error} online={d.online} />
        )
      }
    />
  )
}

/** 中间的声音信息：几块大数字 + 其余注册表标签 + 为什么没有波形 */
function SoundInfo({
  path,
  facts,
  tags,
  error,
  online,
}: {
  path: string
  facts: ReturnType<typeof audioFacts>
  tags?: Record<string, string>
  error: string
  online: boolean
}) {
  const { project } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const rest = restTags(tags, [
    ['Duration', ''],
    ['SampleRate', ''],
    ['NumChannels', ''],
  ])
  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={
        <>
          <Waves className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
          {t('声音')}
        </>
      }
      aside={
        online && (
          <ui.Button
            size="sm"
            variant="ghost"
            disabled={!!busy}
            onClick={() => void run('open', () => op(project.id, 'asset.open', { path }, { instance: 'editor' }))}
          >
            <ExternalLink className="ue:h-3.5 ue:w-3.5" /> {t('在 UE 里打开试听')}
          </ui.Button>
        )
      }
      bodyClass="ue:flex ue:min-h-0 ue:flex-col ue:gap-4 ue:overflow-auto ue:bg-panel ue:p-4"
    >
      {error &&
        (online ? <ErrorText>{error}</ErrorText> : <Why>{t('UE 没连上：声音信息要 UE 读，打开编辑器后自动刷新')}</Why>)}
      {facts.length > 0 && (
        <div className="ue:grid ue:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] ue:gap-2">
          {facts.map((f) => (
            <div key={f.key} className="ue:rounded-lg ue:border ue:border-line ue:bg-card ue:px-3 ue:py-2">
              <div className="ue:text-caption ue:text-subtle">{FACT_LABEL[f.key]?.() ?? f.key}</div>
              <div className="ue:font-mono ue:text-heading ue:font-medium ue:text-fg">{f.value}</div>
            </div>
          ))}
        </div>
      )}
      <div className="ue:flex ue:min-h-32 ue:flex-col ue:items-center ue:justify-center ue:gap-2 ue:rounded-lg ue:border ue:border-dashed ue:border-line ue:p-6 ue:text-center">
        <AudioLines className="ue:h-7 ue:w-7 ue:text-subtle" />
        <div className="ue:text-body ue:font-medium ue:text-fg">{t('波形和频谱还画不了')}</div>
        <p className="ue:max-w-md ue:text-footnote ue:text-subtle">
          {t('要 UELink 导出解码后的 PCM（还没有这个接口）。网页不画假的波形；试听、看波形在 UE 里打开。')}
        </p>
      </div>
      {rest.length > 0 && (
        <div className="ue:rounded-lg ue:border ue:border-line ue:bg-card">
          <InfoRows rows={rest.map(([k, v]) => ({ key: k, label: k, value: v }))} />
        </div>
      )}
    </Card>
  )
}
