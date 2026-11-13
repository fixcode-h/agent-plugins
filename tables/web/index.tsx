import { lazy, Suspense } from 'react'
import { Sheet } from 'lucide-react'
import type { ActivateWeb, WebPlugin } from '../../sdk/web.ts'
import { t } from '@shared/i18n'
import type { Project } from '@shared/schema'
import { tablesOf } from '@shared/tables'
import { TableIcon } from '@/components/layout/rail-icons'
import { ProjectTablesSection } from '@/components/projects/ProjectTablesSection'
import { setTablesHost } from '@/lib/tables-host'
import { sheetClaimer } from './src/lib/sheet-claim'

// 表格页和组件示例带着整套表格编辑器：第一次打开时才执行（esbuild 把 import() 打进同一个文件，但模块到用时才初始化）
const TablesPage = lazy(() => import('./src/pages/TablesPage').then((m) => ({ default: m.TablesPage })))
const TableEditorsSpecimen = lazy(() =>
  import('./src/components/settings/TableEditorsSpecimen').then((m) => ({ default: m.TableEditorsSpecimen })),
)
const HeaderRowsSpecimen = lazy(() =>
  import('./src/components/settings/HeaderRowsSpecimen').then((m) => ({ default: m.HeaderRowsSpecimen })),
)
const TypesSpecimen = lazy(() =>
  import('./src/components/settings/TypesSpecimen').then((m) => ({ default: m.TypesSpecimen })),
)
const RowFormSpecimen = lazy(() =>
  import('./src/components/settings/RowFormSpecimen').then((m) => ({ default: m.RowFormSpecimen })),
)

/**
 * 表格插件的网页入口（面板插件接口 7，ADR 0059；原来是面板自带的表格页，重构文档第 15 条拆出来）：
 * 图标栏的「表格」整页（打开过就一直挂着，切走只藏起来）、项目设置里的「表格」页、设置 →「组件」里的表格编辑器示例。
 * 文案在 activate 之后才取：面板先读好包里的英文再调这里。
 */
const activate: ActivateWeb = (host) => {
  setTablesHost(host)
  return plugin()
}

const plugin = (): WebPlugin => ({
  pages: [
    {
      id: 'tables',
      label: t('表格'),
      icon: TableIcon,
      keep: true,
      Page: ({ path, active }) => (
        <Suspense fallback={null}>
          <TablesPage path={path} active={active} />
        </Suspense>
      ),
    },
  ],
  projectSections: [
    {
      id: 'tables',
      label: t('表格'),
      desc: t(
        '游戏配置表这类表格的目录。设好后图标栏的「表格」里按目录浏览、搜索、筛选、在线改单元格、看版本差异、跨项目对比。保存改动只改单元格的值，文件仍是原来的 Excel / WPS 格式。',
      ),
      icon: Sheet,
      hint: (v) => tablesOf({ plugins: { tables: v } })?.dirs[0],
      Section: ({ value, onChange, project, base }) => (
        <ProjectTablesSection
          value={tablesOf({ plugins: { tables: value } })}
          onChange={onChange}
          // SDK 副本里的 Project 只列了常用字段，运行时就是面板的项目
          project={project as Project | undefined}
          base={base}
          path={base}
        />
      ),
    },
  ],
  // 面板文件弹窗里的表格文件：表格目录里的多「在表格页打开」，表头按项目的表格设置
  sheets: sheetClaimer,
  specimens: [
    {
      id: 'editors',
      label: 'EnumPicker · ListEditor · ProblemsBar',
      tune: ['input', 'menu'],
      Specimen: () => (
        <Suspense fallback={null}>
          <TableEditorsSpecimen />
        </Suspense>
      ),
    },
    {
      id: 'header-rows',
      label: 'HeaderRowsEditor',
      tune: ['input', 'button'],
      Specimen: () => (
        <Suspense fallback={null}>
          <HeaderRowsSpecimen />
        </Suspense>
      ),
    },
    {
      id: 'types',
      label: 'TypeEditor · TypedValueForm',
      tune: ['input', 'button'],
      Specimen: () => (
        <Suspense fallback={null}>
          <TypesSpecimen />
        </Suspense>
      ),
    },
    {
      id: 'row-form',
      label: 'RowForm',
      tune: ['input', 'menu'],
      Specimen: () => (
        <Suspense fallback={null}>
          <RowFormSpecimen />
        </Suspense>
      ),
    },
  ],
})

export default activate
