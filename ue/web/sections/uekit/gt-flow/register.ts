/**
 * 把流程图注册成编辑页的一种视图（gt-edit/views.ts 的注册表），放在列表后面、JSON 前面。
 * gt-edit/index.ts import 这个文件；流程图模块不被 import 时编辑页照常只有列表和 JSON
 */
import { Workflow } from 'lucide-react'
import { t } from '../../../host.ts'
import { registerView } from '../gt-edit/views.ts'
import { FlowEditView } from './FlowEditView.tsx'

registerView({ id: 'flow', label: () => t('流程图'), icon: Workflow, order: 20, Component: FlowEditView })
