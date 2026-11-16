import { TablePickSpecimen } from './sections/gm/TablePick.tsx'
import type { ActivateWeb, Task } from '../../sdk/web.ts'
import type { UeProject } from '../server/types.ts'
import { get } from './api.ts'
import { AssetFile } from './AssetFile.tsx'
import { setHost, t } from './host.ts'
import { GamepadIcon } from './icon.tsx'
import { Status } from './Status.tsx'
import { MenuSpecimen } from './menu.tsx'
import { CategoryBarSpecimen } from './details/CategoryBar.tsx'
import { RefChipSpecimen } from './details/RefChip.tsx'
import { InspectorBarSpecimen } from './inspect/BarSpecimen.tsx'
import { FavFoldersSpecimen } from './sections/assets/FavFolders.tsx'
import { FolderTableSpecimen } from './sections/assets/FolderTableSpecimen.tsx'
import { ForgeSpecimen } from './sections/uekit/ForgeSpecimen.tsx'
import { GtSpecimen } from './sections/uekit/GtSpecimen.tsx'
import { LaunchButtonSpecimen } from './launch-progress/LaunchButton.tsx'
import { OverviewSpecimen } from './sections/overview/Specimen.tsx'
import { TaskPanel } from './TaskPanel.tsx'
import { TreeSearchSpecimen } from './tree-search.tsx'
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
    // 设置 →「组件」里的示例（插件接口 6）：UObject 树、控件树共用的搜索条，UE 页共用的右键菜单
    specimens: [
      { id: 'tree-search', label: 'TreeSearch · TreeList', tune: ['input'], Specimen: TreeSearchSpecimen },
      // UE 页共用的右键菜单（性能页、GameTest）：跟面板「菜单」的调节项
      { id: 'context-menu', label: 'UE · ContextMenu', tune: ['menu'], Specimen: MenuSpecimen },
      // 对象页、资源页的检视区（设计稿 designs/对象页合并与资源导航-设计稿.md 第 9 节）：「最近看过」「更多」下拉跟面板「菜单」走
      { id: 'inspect-bar', label: t('检视 · 导航条'), tune: ['menu'], Specimen: InspectorBarSpecimen },
      { id: 'inspect-ref', label: t('检视 · 引用'), Specimen: RefChipSpecimen },
      { id: 'inspect-cats', label: t('检视 · 分类栏'), tune: ['menu'], Specimen: CategoryBarSpecimen },
      // 资源页文件夹树上面的收藏区和行尾星标：跟面板「行」「菜单」的调节项
      { id: 'fav-folders', label: t('资源 · 收藏的文件夹'), tune: ['row', 'menu'], Specimen: FavFoldersSpecimen },
      // 资源页选中文件夹时右栏的内容表：跟面板「徽标」「行」的调节项
      { id: 'folder-table', label: t('资源 · 文件夹内容表'), tune: ['badge', 'row'], Specimen: FolderTableSpecimen },
      // 启动编辑器按钮上的启动进度：跟面板「按钮」「进度条」的调节项
      { id: 'launch-button', label: 'UE · LaunchButton', tune: ['button', 'progress'], Specimen: LaunchButtonSpecimen },
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
      // GM 页参数关联表格列的可搜索下拉（设计稿 designs/GM页重设计-效果图）：跟面板「输入框」「菜单」的调节项
      { id: 'gm-table-pick', label: t('GM · 参数关联表格下拉'), tune: ['input', 'menu'], Specimen: TablePickSpecimen },
      // GameTest 页的历史条、批量运行条、失败证据：跟面板「徽标」「行」「进度条」的调节项
      {
        id: 'gametest-parts',
        label: 'GameTest · HistoryBar · BatchBar · Evidence',
        tune: ['badge', 'row', 'progress'],
        Specimen: GtSpecimen,
      },
    ],
  }
}

export default activate
