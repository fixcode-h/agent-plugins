import { t } from '../../host.ts'

/**
 * 「新建配置 → 从模板」的内置模板（用户 2026-11-16：支持模板创建，提供模板）。
 * 形状照 UEKit AssetForge 的配置 schema（plugins/AssetForge/Source/AssetForge/Registry/ForgeKindSchema.cpp、
 * 各 kind 头文件开头的「配置形状」注释）：只写结构和必填的，属性值留给人或 Agent 填——
 * 枚举、FText 这类值的写法要看属性编解码，猜错了导入会报诊断，所以模板里不放没把握的属性值。
 *
 * 不出模板的 kind：动画序列、骨骼、骨骼网格体、物理资产（纳管型，资产必须先由 FBX 导入，配置只做微调，走资源页「导出到 JSON」），
 * 状态树（字段多，建议先导出一份现有的照着改，或让 AI 写）。
 */
export interface TplField {
  key: string
  label: () => string
  placeholder?: string
  hint?: () => string
  required?: boolean
  /** 默认值（表单一打开就填好） */
  value?: string
}

export interface ForgeTemplate {
  id: string
  kind: string
  label: () => string
  desc: () => string
  /** 资产名前缀建议（UE 常见命名：WBP_、BP_、M_……），新建时资产路径框的占位 */
  prefix: string
  fields?: TplField[]
  /** 项目模板（配置根 _templates/ 下）：相对 _templates 的路径；读不懂时 bad 是原因，不能选 */
  source?: string
  bad?: string
  /** 生成配置文档：asset 是目标资产包路径（/Game/UI/WBP_X），name 是资产名，v 是表单里其余字段 */
  build: (asset: string, name: string, v: Record<string, string>) => Record<string, unknown>
}

const doc = (kind: string, asset: string, root: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  kind,
  schemaVersion: 1,
  revision: 0,
  asset,
  ...extra,
  root,
})
/** 可选字段：填了才写进配置 */
const opt = (key: string, v: string | undefined) => (v?.trim() ? { [key]: v.trim() } : {})

const PARENT_ACTOR: TplField = {
  key: 'parent',
  label: () => t('父类'),
  placeholder: '/Script/Engine.Actor',
  value: '/Script/Engine.Actor',
  required: true,
  hint: () => t('C++ 类全路径或另一个蓝图，必须是 Actor 派生'),
}

export const FORGE_TEMPLATES: ForgeTemplate[] = [
  {
    id: 'umg-canvas',
    kind: 'umg-widget',
    label: () => t('空白界面（CanvasPanel）'),
    desc: () => t('根是 CanvasPanel，自由摆放子控件，适合整屏界面、HUD'),
    prefix: 'WBP_',
    fields: [
      {
        key: 'parent',
        label: () => t('父类'),
        placeholder: '/Script/UMG.UserWidget',
        hint: () => t('留空用 UserWidget；项目有自己的界面基类时填它'),
      },
    ],
    build: (asset, name, v) =>
      doc('umg-widget', asset, { class: 'CanvasPanel', name: 'RootCanvas', children: [] }, opt('parent', v.parent)),
  },
  {
    id: 'umg-list',
    kind: 'umg-widget',
    label: () => t('竖排面板（VerticalBox）'),
    desc: () => t('根是 VerticalBox，带一个标题和一个内容区，适合弹窗、列表项'),
    prefix: 'WBP_',
    fields: [
      {
        key: 'parent',
        label: () => t('父类'),
        placeholder: '/Script/UMG.UserWidget',
        hint: () => t('留空用 UserWidget；项目有自己的界面基类时填它'),
      },
    ],
    build: (asset, _name, v) =>
      doc(
        'umg-widget',
        asset,
        {
          class: 'VerticalBox',
          name: 'Root',
          children: [
            { class: 'TextBlock', name: 'Title' },
            { class: 'VerticalBox', name: 'Content', children: [] },
          ],
        },
        opt('parent', v.parent),
      ),
  },
  {
    id: 'actor-mesh',
    kind: 'actor-blueprint',
    label: () => t('Actor：场景根 + 静态网格体'),
    desc: () => t('一个场景组件做根，下面挂一个静态网格体组件；只管组件树和父类，事件图表不进配置'),
    prefix: 'BP_',
    fields: [PARENT_ACTOR],
    build: (asset, _name, v) =>
      doc(
        'actor-blueprint',
        asset,
        {
          class: 'ActorComponents',
          name: 'Components',
          children: [
            {
              class: '/Script/Engine.SceneComponent',
              name: 'Root',
              children: [{ class: '/Script/Engine.StaticMeshComponent', name: 'Mesh' }],
            },
          ],
        },
        { parent: v.parent.trim() },
      ),
  },
  {
    id: 'actor-empty',
    kind: 'actor-blueprint',
    label: () => t('Actor：只有父类'),
    desc: () => t('空组件树，组件之后在配置里加或在编辑器里加了再导出'),
    prefix: 'BP_',
    fields: [PARENT_ACTOR],
    build: (asset, _name, v) =>
      doc(
        'actor-blueprint',
        asset,
        { class: 'ActorComponents', name: 'Components', children: [] },
        { parent: v.parent.trim() },
      ),
  },
  {
    id: 'object-bp',
    kind: 'object-blueprint',
    label: () => t('对象蓝图'),
    desc: () => t('非 Actor 的蓝图类（技能、物品定义……），配置写类默认值'),
    prefix: 'BP_',
    fields: [
      {
        key: 'parent',
        label: () => t('父类'),
        placeholder: '/Script/GameplayAbilities.GameplayAbility',
        required: true,
        hint: () => t('非 Actor 派生、可蓝图化、非抽象的类'),
      },
    ],
    build: (asset, name, v) =>
      doc('object-blueprint', asset, { class: 'ClassDefaults', name, props: {} }, { parent: v.parent.trim() }),
  },
  {
    id: 'anim-locomotion',
    kind: 'anim-blueprint',
    label: () => t('动画蓝图：移动状态机'),
    desc: () => t('一个 Locomotion 状态机，Idle 和 Move 两个状态互相转移'),
    prefix: 'ABP_',
    fields: [
      {
        key: 'skeleton',
        label: () => t('骨架'),
        placeholder: '/Game/Characters/Hero/SK_Hero_Skeleton',
        required: true,
        hint: () => t('没有骨架动画蓝图编译不过'),
      },
      { key: 'idle', label: () => t('Idle 动画'), placeholder: '/Game/Characters/Hero/Anims/A_Idle' },
      { key: 'move', label: () => t('Move 动画'), placeholder: '/Game/Characters/Hero/Anims/A_Run' },
    ],
    build: (asset, _name, v) =>
      doc(
        'anim-blueprint',
        asset,
        {
          class: 'AnimGraph',
          name: 'AnimGraph',
          children: [
            {
              class: 'StateMachine',
              name: 'Locomotion',
              entry: 'Idle',
              transitions: [
                { from: 'Idle', to: 'Move' },
                { from: 'Move', to: 'Idle' },
              ],
              children: [
                { class: 'State', name: 'Idle', props: { ...opt('sequence', v.idle), loop: true } },
                { class: 'State', name: 'Move', props: { ...opt('sequence', v.move), loop: true } },
              ],
            },
          ],
        },
        { skeleton: v.skeleton.trim() },
      ),
  },
  {
    id: 'bt-selector',
    kind: 'behavior-tree',
    label: () => t('行为树：Selector + 等待'),
    desc: () => t('根是 Selector，下面一个 Wait 任务，按需往下加节点'),
    prefix: 'BT_',
    fields: [{ key: 'blackboard', label: () => t('黑板'), placeholder: '/Game/AI/BB_Enemy' }],
    build: (asset, _name, v) =>
      doc(
        'behavior-tree',
        asset,
        { class: 'BTComposite_Selector', name: 'Root', children: [{ class: 'BTTask_Wait', name: 'Wait' }] },
        opt('blackboard', v.blackboard),
      ),
  },
  {
    id: 'data-asset',
    kind: 'data-asset',
    label: () => t('数据资产'),
    desc: () => t('UDataAsset 派生类的一份实例；没写的属性导入时重置成默认值'),
    prefix: 'DA_',
    fields: [
      {
        key: 'class',
        label: () => t('资产类'),
        placeholder: '/Script/MyGame.ItemDefinition',
        required: true,
        hint: () => t('UDataAsset 派生类全路径，或蓝图类'),
      },
    ],
    build: (asset, name, v) => doc('data-asset', asset, { class: v.class.trim(), name, props: {} }),
  },
  {
    id: 'data-table',
    kind: 'data-table',
    label: () => t('数据表'),
    desc: () => t('指定行结构体，带一行示例；每行的 props 是这一行的数据'),
    prefix: 'DT_',
    fields: [
      {
        key: 'rowStruct',
        label: () => t('行结构体'),
        placeholder: '/Script/MyGame.ItemRow',
        required: true,
        hint: () => t('/Script/<模块>.<结构体名，不带 F>'),
      },
    ],
    build: (asset, name, v) =>
      doc('data-table', asset, {
        class: '/Script/Engine.DataTable',
        name,
        props: { rowStruct: v.rowStruct.trim() },
        children: [{ class: 'Row', name: 'Row_1', props: {} }],
      }),
  },
  {
    id: 'material-color',
    kind: 'material',
    label: () => t('材质：颜色参数'),
    desc: () => t('一个 Color 向量参数接到基础色，导入后自动排版节点'),
    prefix: 'M_',
    build: (asset, name) =>
      doc('material', asset, {
        class: 'Material',
        name,
        props: {},
        inputs: { BaseColor: 'Color' },
        nodes: [
          {
            name: 'Color',
            class: 'VectorParameter',
            props: { ParameterName: 'Color', DefaultValue: { R: 1, G: 1, B: 1, A: 1 } },
          },
        ],
      }),
  },
  {
    id: 'material-texture',
    kind: 'material',
    label: () => t('材质：贴图采样'),
    desc: () => t('一张贴图接到基础色'),
    prefix: 'M_',
    fields: [{ key: 'texture', label: () => t('贴图'), placeholder: '/Game/Textures/T_Wall.T_Wall' }],
    build: (asset, name, v) =>
      doc('material', asset, {
        class: 'Material',
        name,
        props: {},
        inputs: { BaseColor: 'Tex' },
        nodes: [{ name: 'Tex', class: 'TextureSample', props: { ...opt('Texture', v.texture) } }],
      }),
  },
  {
    id: 'texture',
    kind: 'texture',
    label: () => t('纹理'),
    desc: () => t('从源图导入一张 2D 纹理，导入设置写在 props'),
    prefix: 'T_',
    fields: [
      {
        key: 'source',
        label: () => t('源图'),
        placeholder: 'SourceArt/UI/T_Icon.png',
        required: true,
        hint: () => t('相对项目根的路径，也可以是绝对路径'),
      },
    ],
    build: (asset, name, v) => doc('texture', asset, { class: 'Texture2D', name, source: v.source.trim(), props: {} }),
  },
  {
    id: 'font',
    kind: 'font',
    label: () => t('字体'),
    desc: () => t('一个运行时字体，第一个字体面是 Regular'),
    prefix: 'F_',
    fields: [
      {
        key: 'source',
        label: () => t('Regular 的 ttf'),
        placeholder: 'SourceArt/Fonts/MyFont-Regular.ttf',
        required: true,
        hint: () => t('相对项目根，必须真实存在'),
      },
    ],
    build: (asset, name, v) =>
      doc('font', asset, {
        class: 'Font',
        name,
        props: { FontCacheType: 'Runtime' },
        children: [
          { class: 'FontFace', name: `${name}_Regular`, typeface: 'Regular', source: v.source.trim(), props: {} },
        ],
      }),
  },
  {
    id: 'niagara',
    kind: 'niagara',
    label: () => t('Niagara 系统'),
    desc: () => t('用一个模板发射器复制出发射器，系统层用户参数写在 props'),
    prefix: 'NS_',
    fields: [
      {
        key: 'emitter',
        label: () => t('模板发射器'),
        placeholder: '/Game/VFX/Emitters/NE_Sparks',
        required: true,
        hint: () => t('发射器的形状只能来自模板'),
      },
    ],
    build: (asset, name, v) =>
      doc('niagara', asset, {
        class: 'NiagaraSystem',
        name,
        props: {},
        children: [{ class: v.emitter.trim(), name: 'Emitter', props: {} }],
      }),
  },
  {
    id: 'map',
    kind: 'map',
    label: () => t('地图（世界设置）'),
    desc: () => t('只管世界设置；地图不存在时导入会建一张只含世界设置的空地图'),
    prefix: 'L_',
    build: (asset) => doc('map', asset, { class: '/Script/Engine.WorldSettings', name: 'WorldSettings', props: {} }),
  },
]

/** 各 kind 的配置子目录（forge.kinds 拿不到时的兜底，和 UEKit ForgeKindRegistry 一致） */
export const DEFAULT_DIRS: Record<string, string> = {
  'umg-widget': 'umg',
  'data-asset': 'data',
  'data-table': 'table',
  'actor-blueprint': 'actor',
  'behavior-tree': 'bt',
  'state-tree': 'state-tree',
  'anim-blueprint': 'anim',
  'anim-sequence': 'anim-seq',
  'physics-asset': 'physics-asset',
  skeleton: 'skeleton',
  'skeletal-mesh': 'skeletal-mesh',
  material: 'material',
  map: 'map',
  'object-blueprint': 'object',
  niagara: 'niagara',
  texture: 'texture',
  font: 'font',
}

/** 资产包路径（/Game/UI/WBP_X，也接受对象路径 /Game/UI/WBP_X.WBP_X）→ 规范的包路径和资产名；不像资产路径时返回 undefined */
export function parseAsset(input: string) {
  const s = input
    .trim()
    .replace(/\\/g, '/')
    .replace(/\.[^/]*$/, '')
  if (!/^\/[A-Za-z0-9_]+\/.+/.test(s) || /\/$/.test(s) || /\s/.test(s)) return undefined
  return { asset: s, name: s.split('/').pop()! }
}

/** 资产路径 → 配置相对配置根的路径：/Game/UI/WBP_X ↔ umg/UI/WBP_X.json（插件内容 /Foo/... 照搬挂载点） */
export function configPathFor(dir: string, asset: string) {
  const rel = asset.startsWith('/Game/') ? asset.slice('/Game/'.length) : asset.replace(/^\//, '')
  return `${dir}/${rel}.json`
}

/** 配置相对路径 → 资产路径（configPathFor 反过来）：右键文件夹「在这里新建」时预填 */
export function assetDirFor(folder: string) {
  const parts = folder.replace(/\\/g, '/').split('/').filter(Boolean)
  return `/Game/${parts.slice(1).join('/')}${parts.length > 1 ? '/' : ''}`
}
