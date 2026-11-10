import type { Task } from '../../sdk/web.ts'

/** 模型设计对话：新建时写的 task.plugin，老版本面板建的对话带 modelDesign 标记 */
export const MODE = 'blender.model'
export const isModel = (task: Pick<Task, 'plugin' | 'modelDesign'>) => task.plugin === MODE || task.modelDesign === true
