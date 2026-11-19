import { FileCode, Layers, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { t } from '../../../host.ts'
import { Badge, ErrorText } from '../../../ui.tsx'
import { DetailsCard } from '../preview/DetailsCard.tsx'
import { shortName } from '../preview/model.ts'
import { AssetHead, InfoCard, PickRow, SideCard, Why } from '../preview/parts.tsx'
import { PreviewPane } from '../preview/PreviewPane.tsx'
import { useAssetDesc, usePreviewView, usePropMap } from '../preview/use-asset.ts'
import { LayoutShell } from '../shell/LayoutShell.tsx'
import type { LayoutProps } from '../types.ts'
import { emitters } from './model.ts'

/**
 * Niagara 系统（设计稿第 3 节、效果图 B10 简版）：左边发射器（关掉的灰显）和它们的脚本，点一个在右栏看细节；
 * 中间预览问 UE（asset.preview 现在不支持 Niagara，原样显示 UE 给的原因，不画假的粒子）；右边细节。
 * 模块栈（Emitter Spawn / Particle Update 里的模块）在脚本图里，UELink 导不出来，写明
 */
export function NiagaraLayout(p: LayoutProps) {
  const { path, layout, onOpen, hint, marks } = p
  const [view, setView] = usePreviewView()
  const d = useAssetDesc(path)
  const props = usePropMap(path)
  const list = useMemo(() => emitters(props.map, d.desc?.subobjects), [props.map, d.desc])
  const [picked, setPicked] = useState({ path, sub: '' })
  const sub = picked.path === path ? picked.sub : ''
  const pick = (s: string) => setPicked({ path, sub: s })
  const err = d.error || props.error
  return (
    <LayoutShell
      layout={layout}
      head={
        <AssetHead
          path={path}
          icon={Sparkles}
          cls={d.desc?.class ?? 'NiagaraSystem'}
          badges={<Badge>{t('简版')}</Badge>}
          view={view}
          onView={setView}
        />
      }
      regions={{
        emitters: (
          <SideCard title={t('系统概览')} icon={Layers} aside={t('{n} 个发射器', { n: list.length })}>
            {err && (
              <div className="ue:px-3 ue:py-1">
                {d.online ? (
                  <ErrorText>{err}</ErrorText>
                ) : (
                  <Why>{t('UE 没连上：发射器要 UE 读，打开编辑器后自动刷新')}</Why>
                )}
              </div>
            )}
            <PickRow icon={Sparkles} label={t('系统')} aside={shortName(path)} on={!sub} onClick={() => pick('')} />
            {list.map((e) => (
              <div key={e.name + e.path}>
                <PickRow
                  icon={Sparkles}
                  label={<span className="ue:font-medium">{e.name}</span>}
                  aside={e.enabled ? undefined : t('已关闭')}
                  muted={!e.enabled}
                  title={e.path}
                  on={!!e.path && sub === e.path}
                  onClick={e.path ? () => pick(e.path) : undefined}
                />
                {e.scripts.map((s) => (
                  <PickRow
                    key={s.path}
                    depth={1}
                    icon={FileCode}
                    label={s.name}
                    muted={!e.enabled}
                    title={s.path}
                    on={sub === s.path}
                    onClick={() => pick(s.path)}
                  />
                ))}
              </div>
            ))}
            {!list.length && !err && <Why>{t('没读到发射器')}</Why>}
            <Why>{t('模块栈（每段脚本里的模块和参数）在脚本图里，UELink 还导不出来；改模块回 UE 编辑器。')}</Why>
          </SideCard>
        ),
        details: (
          <DetailsCard path={path} sub={sub} onBack={() => pick('')} onOpen={onOpen} hint={hint} marks={marks} />
        ),
      }}
      center={
        view === 'info' ? (
          <InfoCard path={path} onOpen={onOpen} />
        ) : (
          <PreviewPane path={path} icon={Sparkles} orbitable={false} />
        )
      }
    />
  )
}
