import { Sparkles } from 'lucide-react'
import { TableBindDialogSpecimen } from './sections/gm/TableBindDialog.tsx'
import { TablePickSpecimen } from './sections/gm/TablePick.tsx'
import type { ActivateWeb, Task } from '../../sdk/web.ts'
import type { UeProject } from '../server/types.ts'
import { get } from './api.ts'
import { AssetFile } from './AssetFile.tsx'
import { setHost, t } from './host.ts'
import { GamepadIcon } from './icon.tsx'
import { Status } from './Status.tsx'
import { MenuSpecimen } from './menu.tsx'
import { PathTextSpecimen } from './path-text.tsx'
import { LoadingMaskSpecimen } from './loading-mask/LoadingMask.tsx'
import { CategoryBarSpecimen } from './details/CategoryBar.tsx'
import { RefChipSpecimen } from './details/RefChip.tsx'
import { InspectorBarSpecimen } from './inspect/BarSpecimen.tsx'
import { LayoutSettingsSpecimen, TimelineSpecimen, UmgLayoutSpecimen } from './inspect/layouts/settings/Specimen.tsx'
import { DirtyListSpecimen } from './asset-dirty/DirtyList.tsx'
import { FavFoldersSpecimen } from './sections/assets/FavFolders.tsx'
import { FolderTableSpecimen } from './sections/assets/FolderTableSpecimen.tsx'
import { ForgeSpecimen } from './sections/uekit/ForgeSpecimen.tsx'
import { ForgeConfigPreviewSpecimen } from './sections/uekit/ForgeConfigPreview.tsx'
import { ForgeMarkupSpecimen } from './sections/uekit/forge-markup/ForgeMarkupSpecimen.tsx'
import { FlowSpecimen } from './sections/uekit/gt-flow/FlowSpecimen.tsx'
import { EditSpecimen } from './sections/uekit/gt-edit/EditSpecimen.tsx'
import { DebugSpecimen } from './sections/uekit/gt-debug/DebugSpecimen.tsx'
import { RefSpecimen } from './sections/uekit/gt-ref/RefSpecimen.tsx'
import { ObjOpsSpecimen } from './sections/uekit/gt-blocks/ObjOpsSpecimen.tsx'
import { GtSpecimen } from './sections/uekit/GtSpecimen.tsx'
import { GtTidyReport } from './sections/uekit/GtTidyReport.tsx'
import { TIDY_LANG } from '../server/uekit/gt-tidy-plan.ts'
import { DiagSpecimen } from './sections/uekit/LinkDiagnose.tsx'
import { PluginCardSpecimen } from './sections/uekit/plugins/Specimen.tsx'
import { ConfigKeySpecimen } from './sections/config/parts.tsx'
import { LaunchButtonSpecimen } from './launch-progress/LaunchButton.tsx'
import { ConnPillSpecimen } from './conn/ConnPill.tsx'
import { ArgPresetsSpecimen } from './sections/gm/presets/ArgPresets.tsx'
import { InstancePickSpecimen } from './obj-kit/InstancePick.tsx'
import { OverviewSpecimen } from './sections/overview/Specimen.tsx'
import { LuaDebugSpecimen } from './sections/lua/DebugSpecimen.tsx'
import { LuaObjectsSpecimen } from './sections/lua/objects-tree/Specimen.tsx'
import { TaskPanel } from './TaskPanel.tsx'
import { VsDebugSpecimen } from './vs-debug/Specimen.tsx'
import { TreeSearchSpecimen } from './tree-search.tsx'
import { SuggestInputSpecimen } from './SuggestInput.tsx'
import { UePage } from './UePage.tsx'

/** 接入了 UE 的面板项目（对话右栏的「UE」页签按它判断）：激活时取一次，之后每分钟刷新 */
let ueProjects = new Set<string>()
async function refresh() {
  ueProjects = new Set(
    (await get<{ projects: UeProject[] }>('/projects').catch(() => ({ projects: [] }))).projects.map((p) => p.id),
  )
}

/**
 * UE 插件的网页入口（agent-panel 插件 SDK，插件接口 2）：图标栏里的 UE 管理页、接入 UE 的项目里对话右栏的「UE」页签、.uasset 文件的查看窗口、
 * 插件页上的运行状态。文案在 activate 之后才取：面板先读好包里的英文再调这里
 */
const activate: ActivateWeb = (host) => {
  setHost(host)
  void refresh()
  setInterval(() => void refresh(), 60000)
  return {
    // 按项目生效（插件接口 9）：页面进侧栏的「项目工具」，面板给出当前项目
    // cover：从项目工具打开时 UE 页的左栏盖住会话侧栏，左栏顶上的项目卡片点一下回到项目对话
    pages: [{ id: 'main', label: 'UE', icon: GamepadIcon, scope: 'project', cover: true, Page: UePage }],
    taskTabs: [
      {
        id: 'ue',
        label: 'UE',
        icon: GamepadIcon,
        when: (task: Task) => ueProjects.has(task.projectId) && task.mode !== 'chat' && !task.plugin,
        Panel: ({ task }) => <TaskPanel taskId={task.id} projectId={task.projectId} />,
      },
    ],
    // 对话里的文件标记、文件浏览页点 .uasset：弹窗里看 DataTable、DataAsset、蓝图默认值（旧面板没有这一项，照旧交给系统打开）
    fileViewers: [{ id: 'asset', exts: ['uasset'], icon: GamepadIcon, Viewer: AssetFile }],
    Status,
    // AI 分析窗口右侧的应用面板（插件接口 6）：GameTest「AI 整理」回复里的 gametest-tidy 代码块，逐条勾选后写回场景
    reports: [
      {
        id: 'gametest-tidy',
        lang: TIDY_LANG,
        title: t('GameTest 整理'),
        desc: t('AI 看截图、读项目代码给出的步骤改动，逐条勾选，应用后写回场景（原录制备份）'),
        icon: Sparkles,
        Report: ({ task, messageId, text }) => <GtTidyReport task={task} messageId={messageId} text={text} />,
      },
    ],
    // 设置 →「组件」里的示例（插件接口 6）：UObject 树、控件树共用的搜索条，UE 页共用的右键菜单
    specimens: [
      { id: 'tree-search', label: 'TreeSearch · TreeList', tune: ['input'], Specimen: TreeSearchSpecimen },
      // GameTest 流程图（定稿 9.1）：面板开放的通用画布 + 次数角标 + 节点卡片和圆点引脚，跟面板「流程图画布」「数字角标」「流程图节点」「流程图引脚」的调节项
      {
        id: 'gt-flow',
        label: t('GameTest · 流程图'),
        tune: ['canvas', 'countBadge', 'flowNode', 'flowPin'],
        Specimen: FlowSpecimen,
      },
      // GameTest 脚本编辑页（定稿 9.2–9.5）：列表视图、检查器、条件组编辑器，跟面板「行」「输入框」「菜单」的调节项
      { id: 'gt-edit', label: t('GameTest · 脚本编辑'), tune: ['row', 'input', 'menu'], Specimen: EditSpecimen },
      // GameTest 调试和运行面板（定稿 9.2、效果图 6）：停在断点上的运行横条、运行记录和此刻的变量
      { id: 'gt-debug', label: t('GameTest · 调试和运行面板'), tune: ['row', 'input'], Specimen: DebugSpecimen },
      // GameTest 从游戏里抓（定稿 9.3）：实时画面、控件状态、分组字段和「变了闪一下」，跟面板「行」的调节项
      { id: 'gt-ref', label: t('GameTest · 对象和判断'), tune: ['row', 'input', 'menu'], Specimen: RefSpecimen },
      {
        id: 'gt-obj-ops',
        label: t('GameTest · 对象块和对象动作'),
        tune: ['row', 'input', 'menu'],
        Specimen: ObjOpsSpecimen,
      },
      // UE 页共用的右键菜单（性能页、GameTest）：跟面板「菜单」的调节项
      { id: 'context-menu', label: 'UE · ContextMenu', tune: ['menu'], Specimen: MenuSpecimen },
      // 能手填也能从下拉里挑的输入框（GameTest 运行设置的阻挡界面）：跟面板「输入框」「菜单」的调节项
      { id: 'suggest-input', label: 'UE · SuggestInput', tune: ['input', 'menu'], Specimen: SuggestInputSpecimen },
      // 一行放不下的长路径（AssetForge 配置根、新建配置弹窗）：省略前面的目录，悬停看全、点一下复制
      { id: 'path-text', label: 'UE · PathText', Specimen: PathTextSpecimen },
      // 切换内容时盖住还没画完的区域（AssetForge 切配置），画完才揭开
      { id: 'loading-mask', label: 'UE · LoadingMask', Specimen: LoadingMaskSpecimen },
      // 对象页、资源页的检视区（设计稿 designs/对象页合并与资源导航-设计稿.md 第 9 节）：「最近看过」「更多」下拉跟面板「菜单」走
      { id: 'inspect-bar', label: t('检视 · 导航条'), tune: ['menu'], Specimen: InspectorBarSpecimen },
      { id: 'inspect-ref', label: t('检视 · 引用'), Specimen: RefChipSpecimen },
      { id: 'inspect-cats', label: t('检视 · 分类栏'), tune: ['menu'], Specimen: CategoryBarSpecimen },
      // 资源查看页按 UE 编辑器布局（设计稿 designs/资源查看页-按UE编辑器布局-设计稿.md）：UMG 布局（控件树、近似预览、细节、动画时间轴）、
      // 共用的动画时间轴、布局注册表的设置；跟面板「行」「输入框」「菜单」的调节项
      {
        id: 'asset-layout-umg',
        label: t('资源查看布局 · UMG'),
        tune: ['row', 'input', 'menu'],
        Specimen: () => <UmgLayoutSpecimen />,
      },
      { id: 'asset-timeline', label: t('资源查看布局 · 动画时间轴'), tune: ['row'], Specimen: TimelineSpecimen },
      {
        id: 'asset-layouts',
        label: t('资源查看布局 · 设置'),
        tune: ['badge', 'button'],
        Specimen: LayoutSettingsSpecimen,
      },
      // 资源页文件夹树上面的收藏区和行尾星标：跟面板「行」「菜单」的调节项
      // 资源页文件夹树上面的「当前修改」：跟面板「行」「徽标」「菜单」的调节项
      { id: 'dirty-list', label: t('资源 · 当前修改'), tune: ['row', 'badge', 'menu'], Specimen: DirtyListSpecimen },
      { id: 'fav-folders', label: t('资源 · 收藏的文件夹'), tune: ['row', 'menu'], Specimen: FavFoldersSpecimen },
      // 资源页选中文件夹时右栏的内容表：跟面板「徽标」「行」的调节项
      { id: 'folder-table', label: t('资源 · 文件夹内容表'), tune: ['badge', 'row'], Specimen: FolderTableSpecimen },
      // 启动编辑器按钮上的启动进度：跟面板「按钮」「进度条」的调节项
      { id: 'launch-button', label: 'UE · LaunchButton', tune: ['button', 'progress'], Specimen: LaunchButtonSpecimen },
      { id: 'conn-pill', label: 'UE · ConnPill', tune: ['button'], Specimen: ConnPillSpecimen },
      { id: 'arg-presets', label: 'UE · ArgPresets', tune: ['button'], Specimen: ArgPresetsSpecimen },
      { id: 'instance-pick', label: 'UE · InstancePick', tune: ['button'], Specimen: InstancePickSpecimen },
      // 概览的读数、「需要你处理」、时间线，跳转弹窗的行和左栏入口：跟面板「行」「徽标」「按钮」的调节项
      {
        id: 'overview-parts',
        label: t('概览 · 需要你处理 · 跳转'),
        tune: ['row', 'badge', 'button'],
        Specimen: OverviewSpecimen,
      },
      // AssetForge 页的同步状态徽标、配置 → 资源关系条、作业报告：跟面板「徽标」「行」的调节项
      {
        id: 'forge-parts',
        label: 'AssetForge · StatePill · ForgeLink · JobReport',
        tune: ['badge', 'row'],
        Specimen: ForgeSpecimen,
      },
      // AssetForge 资源还没生成时按配置画的预览：左边结构树（能拖宽），右边和真实资源同一个细节面板；跟面板「行」「输入框」的调节项
      {
        id: 'forge-config-preview',
        label: t('AssetForge · 按配置预览'),
        tune: ['row', 'input'],
        Specimen: ForgeConfigPreviewSpecimen,
      },
      // AssetForge 的标记视图（设计稿 4.2）：配置按段画成类似 XAML 的标签，颜色带色块、片段来的节点和段标出文件；跟面板「行」的调节项
      {
        id: 'forge-markup',
        label: t('AssetForge · 标记视图'),
        tune: ['row'],
        Specimen: ForgeMarkupSpecimen,
      },
      // GM 页参数关联表格列的可搜索下拉（设计稿 designs/GM页重设计-效果图）：跟面板「输入框」「菜单」的调节项
      { id: 'gm-table-pick', label: t('GM · 参数关联表格下拉'), tune: ['input', 'menu'], Specimen: TablePickSpecimen },
      // 参数关联表格的弹窗：搜表、页签、主列、描述列、辅助描述列
      {
        id: 'gm-table-bind',
        label: t('GM · 参数关联表格'),
        tune: ['input', 'menu'],
        Specimen: TableBindDialogSpecimen,
      },
      // GameTest 页的历史条、批量运行条、失败证据：跟面板「徽标」「行」「进度条」的调节项
      {
        id: 'gametest-parts',
        label: 'GameTest · HistoryBar · BatchBar · Evidence',
        tune: ['badge', 'row', 'progress'],
        Specimen: GtSpecimen,
      },
      // UE 插件页的插件卡片（版本、实测引擎、依赖、工具的字段表）：跟面板「徽标」「按钮」的调节项
      { id: 'plugin-card', label: t('UE 插件 · 插件卡片'), tune: ['badge', 'button'], Specimen: PluginCardSpecimen },
      // UE 插件页的连接诊断：每项一行，跟面板「行」「按钮」的调节项
      { id: 'link-diagnose', label: t('UE · 连接诊断'), tune: ['row', 'button'], Specimen: DiagSpecimen },
      // 配置页一个键的各层写法：跟面板「徽标」「行」的调节项
      { id: 'config-key', label: t('UE · 配置的分层'), tune: ['badge', 'row'], Specimen: ConfigKeySpecimen },
      // Lua 页「调试」页签：快照记录，跟面板「行」「徽标」的调节项
      { id: 'lua-debug', label: t('Lua · 快照'), tune: ['row', 'badge'], Specimen: LuaDebugSpecimen },
      // Lua 页「对象」页签：树的行、对象卡、继承链、对象状态、已销毁对象，跟面板「行」「徽标」「按钮」的调节项
      {
        id: 'lua-objects',
        label: t('Lua · 对象树 · 对象卡 · 继承链'),
        tune: ['row', 'badge', 'button'],
        Specimen: LuaObjectsSpecimen,
      },
      // 概览的「VS 调试」卡片（UEToVS 0.8.0 调试控制）：没开 VS、运行中、停在断点三种状态，跟面板「按钮」「图标按钮」「小标签」「输入框」的调节项
      {
        id: 'vs-debug',
        label: t('UE · VS 调试'),
        tune: ['button', 'iconButton', 'badge', 'input'],
        Specimen: VsDebugSpecimen,
      },
    ],
  }
}

export default activate
