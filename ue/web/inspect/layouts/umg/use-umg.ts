import { useMemo } from 'react'
import { op, useLoad } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { useTargetInfo } from '../../../ui.tsx'
import { parseAnims, type Anim } from '../../../timeline/keys.ts'
import type { AssetConfig } from '../types.ts'
import { resolveStyles } from '../../../../shared/forge-doc/styles.ts'
import { fromConfig, parseUmgConfig, type UmgConfig } from './config.ts'
import { fromDesign, type UmgDesign, type WNode } from './model.ts'
import { liveRefIssues } from './subref/preview.ts'
import { graftRefs } from './subref/refs.ts'
import { useSubConfigs } from './subref/use-subrefs.ts'

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
  /** 解析好的配置（展开 include 的那份优先）：细节面板按节点路径取原节点和 styles */
  configDoc?: UmgConfig
  /** 配置原文（「配置原文」视图）：AssetForge 页传进来的，或资源页按资产问 forge.describe 的 */
  configText?: string
  parent?: string
  loading: boolean
  /** 子界面在 UE 那边对不上（子 WBP 没生成、父 WBP 没按新配置导入）：画布上写明，UE 渲染图里那块为什么是空的 */
  refNotes: string[]
  /** 打开另一份配置（AssetForge 页才有）：双击子界面 */
  openConfig?: (file: string) => void
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
    // ref 也挂上：UE 回的子界面节点没有子控件，按配置的 ref 读子配置嫁接（subref/）
    return {
      ...n,
      props: n.props ?? c?.props,
      slot: n.slot ?? c?.slot,
      at: c?.at,
      ref: c?.ref,
      children: n.children.map(visit),
    }
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
  const parsed = useMemo(() => parseUmgConfig(configText), [configText])
  // AssetForge 页给了展开 include 的配置就用它（片段里的节点也画出来、路径和写回查的对得上）
  const cfg = (config?.doc && typeof config.doc === 'object' ? (config.doc as UmgConfig) : undefined) ?? parsed
  // 预览按套好样式的节点画（和导入出来的一样）；节点路径不变，细节面板再按路径取没套样式的原节点
  const cfgTree = useMemo(() => (cfg?.root ? fromConfig(resolveStyles(cfg.root, cfg.styles)) : undefined), [cfg])
  const designErr = design.error && !unsupported(design.error) ? design.error : ''
  const animsErr = anims.error && !unsupported(anims.error) ? anims.error : ''
  const live = design.data?.root ? design.data : undefined
  // 子界面的配置（ref）：知道配置根时读出来嫁接进树；cfg 换了（存盘重读）跟着重读
  const subs = useSubConfigs(project.id, config?.root, config?.file, cfg, cfg)

  return useMemo(() => {
    const liveTree = live ? withConfigProps(fromDesign(live.root), cfgTree) : undefined
    const base = liveTree ?? cfgTree
    const tree = base && graftRefs(base, config?.file, config?.file ? subs : undefined)
    const ueAnims = anims.data ? parseAnims(anims.data.animations) : undefined
    const cfgAnims = parseAnims(cfg?.animations)
    return {
      tree,
      source: live ? 'ue' : cfgTree ? 'config' : 'none',
      anims: ueAnims ?? cfgAnims,
      animSource: ueAnims ? 'ue' : cfg?.animations ? 'config' : 'none',
      animsTruncated: !!anims.data?.truncated,
      canRender: !!live && has('umg.render'),
      configDoc: cfg,
      configText,
      parent: live?.parent ?? cfg?.parent,
      refNotes: liveRefIssues(cfgTree, liveTree),
      openConfig: config?.openConfig,
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
    subs,
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
