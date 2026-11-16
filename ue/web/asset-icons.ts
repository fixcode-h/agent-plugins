import {
  Activity,
  AppWindow,
  Atom,
  AudioLines,
  Bone,
  Box,
  Boxes,
  Braces,
  File,
  Film,
  Gem,
  Image,
  Languages,
  ListOrdered,
  Map as MapIcon,
  Network,
  Palette,
  PersonStanding,
  Puzzle,
  Sparkles,
  Spline,
  Table,
  Type,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { t } from './host.ts'

/**
 * 资源类型的图标和颜色，AssetForge 页和资源页的文件夹树共用一套（设计稿「对象页合并与资源导航」第 8 节：
 * 两处同一种资源要长得一样，不然用户在两页之间对不上）。颜色只用面板主题色，不自造。
 */
export interface KindMeta {
  icon: LucideIcon
  /** 图标颜色的类名 */
  tone: string
  label: () => string
}

/** 键是 AssetForge 的 kind（UEKit ForgeKindRegistry 登记表），AssetForge 页按它画 */
export const ASSET_KINDS: Record<string, KindMeta> = {
  'umg-widget': { icon: AppWindow, tone: 'ue:text-accent-text', label: () => 'UMG' },
  'actor-blueprint': { icon: Boxes, tone: 'ue:text-run', label: () => t('Actor 蓝图') },
  'object-blueprint': { icon: Puzzle, tone: 'ue:text-run', label: () => t('对象蓝图') },
  'anim-blueprint': { icon: Activity, tone: 'ue:text-run', label: () => t('动画蓝图') },
  'anim-sequence': { icon: Film, tone: 'ue:text-success', label: () => t('动画序列') },
  'behavior-tree': { icon: Network, tone: 'ue:text-success', label: () => t('行为树') },
  'state-tree': { icon: Workflow, tone: 'ue:text-success', label: () => t('状态树') },
  material: { icon: Palette, tone: 'ue:text-warning', label: () => t('材质') },
  niagara: { icon: Sparkles, tone: 'ue:text-danger', label: () => 'Niagara' },
  texture: { icon: Image, tone: 'ue:text-warning', label: () => t('纹理') },
  'data-table': { icon: Table, tone: 'ue:text-accent-text', label: () => t('数据表') },
  'data-asset': { icon: Gem, tone: 'ue:text-run', label: () => t('数据资产') },
  'skeletal-mesh': { icon: PersonStanding, tone: 'ue:text-accent-text', label: () => t('骨骼网格体') },
  skeleton: { icon: Bone, tone: 'ue:text-muted', label: () => t('骨骼') },
  'physics-asset': { icon: Atom, tone: 'ue:text-muted', label: () => t('物理资产') },
  map: { icon: MapIcon, tone: 'ue:text-warning', label: () => t('地图') },
  font: { icon: Type, tone: 'ue:text-muted', label: () => t('字体') },
}

/** UE 类名 → 上面的 kind：资源注册表给的是类名（WidgetBlueprint），AssetForge 给的是 kind，两边落到同一个图标 */
const CLASS_KIND: Record<string, string> = {
  WidgetBlueprint: 'umg-widget',
  EditorUtilityWidgetBlueprint: 'umg-widget',
  Blueprint: 'actor-blueprint',
  AnimBlueprint: 'anim-blueprint',
  AnimSequence: 'anim-sequence',
  AnimMontage: 'anim-sequence',
  AnimComposite: 'anim-sequence',
  BlendSpace: 'anim-sequence',
  BlendSpace1D: 'anim-sequence',
  BehaviorTree: 'behavior-tree',
  BlackboardData: 'behavior-tree',
  StateTree: 'state-tree',
  Material: 'material',
  MaterialInstanceConstant: 'material',
  MaterialFunction: 'material',
  MaterialParameterCollection: 'material',
  NiagaraSystem: 'niagara',
  NiagaraEmitter: 'niagara',
  Texture2D: 'texture',
  TextureCube: 'texture',
  TextureRenderTarget2D: 'texture',
  DataTable: 'data-table',
  CompositeDataTable: 'data-table',
  CurveTable: 'data-table',
  DataAsset: 'data-asset',
  PrimaryDataAsset: 'data-asset',
  SkeletalMesh: 'skeletal-mesh',
  Skeleton: 'skeleton',
  PhysicsAsset: 'physics-asset',
  World: 'map',
  Font: 'font',
  FontFace: 'font',
}

/** AssetForge 不管、但资源页常见的类型 */
const CLASS_EXTRA: Record<string, Omit<KindMeta, 'label'>> = {
  StaticMesh: { icon: Box, tone: 'ue:text-accent-text' },
  SoundWave: { icon: AudioLines, tone: 'ue:text-success' },
  SoundCue: { icon: AudioLines, tone: 'ue:text-success' },
  MetaSoundSource: { icon: AudioLines, tone: 'ue:text-success' },
  CurveFloat: { icon: Spline, tone: 'ue:text-muted' },
  CurveVector: { icon: Spline, tone: 'ue:text-muted' },
  CurveLinearColor: { icon: Spline, tone: 'ue:text-muted' },
  StringTable: { icon: Languages, tone: 'ue:text-accent-text' },
  UserDefinedStruct: { icon: Braces, tone: 'ue:text-muted' },
  UserDefinedEnum: { icon: ListOrdered, tone: 'ue:text-muted' },
}

const UNKNOWN = { icon: File, tone: 'ue:text-subtle' }

/** 按资源类名取图标和颜色；类名空（磁盘兜底认不出类型）或不认识时给普通文件图标 */
export function assetIcon(cls: string): { icon: LucideIcon; tone: string } {
  const kind = CLASS_KIND[cls]
  if (kind) return ASSET_KINDS[kind]
  if (CLASS_EXTRA[cls]) return CLASS_EXTRA[cls]
  // 项目或插件自己的蓝图子类型（EditorUtilityBlueprint、GameplayAbilityBlueprint……）都当蓝图画
  if (/Blueprint$/.test(cls)) return ASSET_KINDS['object-blueprint']
  return UNKNOWN
}

/** 资源类名的显示名（文件夹内容表的类型列和类型胶囊）：AssetForge 认得的用它的中文名，其余照类名 */
export function assetClassLabel(cls: string): string {
  if (!cls) return t('未知类型')
  const kind = CLASS_KIND[cls]
  return kind && kind !== 'actor-blueprint' && kind !== 'object-blueprint' ? ASSET_KINDS[kind].label() : cls
}
