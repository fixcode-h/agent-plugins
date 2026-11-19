import { useMemo } from 'react'
import { op, useLoad } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { useTargetInfo } from '../../../ui.tsx'
import { parseAnims, type Anim } from '../../../timeline/keys.ts'
import type { AssetConfig } from '../types.ts'
import { fromConfig, parseUmgConfig } from './config.ts'
import { fromDesign, type UmgDesign, type WNode } from './model.ts'

/**
 * UMG 布局的数据：能问 UE 时用 UELink 的 umg.design / umg.anims（另一路在 C++ 里加，2026-11-19），
 * 问不了（UE 没开、桥接旧没有这些操作、资源还没导入）时降级到 AssetForge 配置（设计稿 U4）。
 * 新旧桥接看 /info 的 ops（UELink 认得的操作列表，旧 UELink 没有这个字段就当不支持）；
 * 名单里有、调用又说不认识（名单和操作表对不上）也当不支持，不把「未知操作」当错误甩给用户。
 */
export const unsupported = (msg: string) => /不支持|unknown|未知操作|没有这个操作/i.test(msg)

export type Source = 'ue' | 'config' | 'none'

export interface UmgData {
  tree?: WNode
  /** 控件树从哪来：UE 的设计时控件树、AssetForge 配置，或者都没有 */
  source: Source
  anims: Anim[]
  animSource: Source
  /** umg.anims 的关键帧总数超上限被截断（UELink 2.17：超 1500 个） */
  animsTruncated: boolean
  /** 能让 UE 离屏渲染（umg.render）：有就用实时预览，没有画近似预览 */
  canRender: boolean
  /** 配置原文（「配置原文」视图）：AssetForge 页传进来的，或资源页按资产问 forge.describe 的 */
  configText?: string
  parent?: string
  loading: boolean
  /** 真出错（不是「不支持」）：显示给用户 */
  error: string
  reload: () => void
}

/** UE 回的树没有属性：同名路径在配置里有的，把配置的属性和插槽挂上（近似预览、离线细节用） */
function withConfigProps(live: WNode, cfg?: WNode): WNode {
  if (!cfg) return live
  const idx = new Map<string, WNode>()
  const walk = (n: WNode) => {
    idx.set(n.key, n)
    n.children.forEach(walk)
  }
  walk(cfg)
  const visit = (n: WNode): WNode => {
    const c = idx.get(n.key)
    return { ...n, props: n.props ?? c?.props, slot: n.slot ?? c?.slot, children: n.children.map(visit) }
  }
  return visit(live)
}

export function useUmgData(path: string, config: AssetConfig | undefined, offline: boolean | undefined): UmgData {
  const { project, state } = useUe()
  const { inst } = useTargetInfo()
  const has = (name: string) => !offline && !!inst?.online && !!inst.ops?.includes(name)
  const canDesign = has('umg.design')
  const canAnims = has('umg.anims')
  const forge = !offline && !config && !!state?.extensions?.some((x) => x.name === 'AssetForge')
  const pkg = path.split('.')[0]

  const design = useLoad(
    () =>
      canDesign ? op<UmgDesign>(project.id, 'umg.design', { path }, undefined, 60000) : Promise.resolve(undefined),
    [project.id, path, canDesign],
  )
  const anims = useLoad(
    () =>
      canAnims
        ? op<{ animations: unknown; truncated?: boolean }>(project.id, 'umg.anims', { path }, undefined, 60000)
        : Promise.resolve(undefined),
    [project.id, path, canAnims],
  )
  // 资源页没有配置原文：装了 AssetForge 时按资产问一次（有配置才有）
  const desc = useLoad(
    () =>
      forge
        ? op<{ configText?: string; managed?: boolean }>(project.id, 'forge.describe', { asset: pkg }).catch(
            () => undefined,
          )
        : Promise.resolve(undefined),
    [project.id, pkg, forge],
  )
  const configText = config ? config.text : desc.data?.managed !== false ? desc.data?.configText : undefined
  const cfg = useMemo(() => parseUmgConfig(configText), [configText])
  const cfgTree = useMemo(() => (cfg?.root ? fromConfig(cfg.root) : undefined), [cfg])
  const designErr = design.error && !unsupported(design.error) ? design.error : ''
  const animsErr = anims.error && !unsupported(anims.error) ? anims.error : ''
  const live = design.data?.root ? design.data : undefined

  return useMemo(() => {
    const tree = live ? withConfigProps(fromDesign(live.root), cfgTree) : cfgTree
    const ueAnims = anims.data ? parseAnims(anims.data.animations) : undefined
    const cfgAnims = parseAnims(cfg?.animations)
    return {
      tree,
      source: live ? 'ue' : cfgTree ? 'config' : 'none',
      anims: ueAnims ?? cfgAnims,
      animSource: ueAnims ? 'ue' : cfg?.animations ? 'config' : 'none',
      animsTruncated: !!anims.data?.truncated,
      canRender: !!live && has('umg.render'),
      configText,
      parent: live?.parent ?? cfg?.parent,
      loading: design.loading || anims.loading || desc.loading || !!config?.loading,
      error: designErr || animsErr || config?.error || '',
      reload: () => {
        design.reload()
        anims.reload()
        desc.reload()
      },
    } satisfies UmgData
    // has 跟着 inst 变
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [
    live,
    cfgTree,
    cfg,
    anims.data,
    configText,
    design.loading,
    anims.loading,
    desc.loading,
    config,
    designErr,
    animsErr,
    inst,
  ])
}
