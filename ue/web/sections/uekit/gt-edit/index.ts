/**
 * 编辑页的入口：注册自带的视图（列表、JSON）。别的视图（流程图）在自己的模块里 registerView，并在这里加一行 import
 */
import { Braces, ListTree } from 'lucide-react'
import { t } from '../../../host.ts'
import { JsonView } from './JsonView.tsx'
import { ListView } from './ListView.tsx'
import { registerView } from './views.ts'
import '../gt-flow/register.ts'

registerView({ id: 'list', label: () => t('列表'), icon: ListTree, order: 10, Component: ListView })
registerView({ id: 'json', label: () => t('JSON'), icon: Braces, order: 90, Component: JsonView })

export { allViews, registerView, type ViewDef, type ViewProps } from './views.ts'
export { GtEditor } from './GtEditor.tsx'
