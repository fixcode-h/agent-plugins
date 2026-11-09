import type { McpTool } from '../../sdk/server.ts'
import { mcpText } from './mcp-text.ts'
import { sceneText } from './model-meta.ts'
import { runPython, sceneObjects } from './model.ts'

/**
 * 模型设计对话的两个工具（面板 ADR 0025，ADR 0059 迁进 Blender 插件）：
 * 在这个对话自己的后台 Blender 里执行 bpy、查看场景，执行完自动存档并刷新网页里的 3D 预览。
 * bpy 代码能做 Blender 能做的一切，不为每种操作单独设计工具。
 */
export const MODEL_TOOLS: McpTool[] = [
  {
    name: 'blender_python',
    description:
      '在当前模型的 Blender 场景里执行一段 Python（bpy）代码。可以直接用 bpy、bmesh、mathutils、math、Vector；上一段定义的变量和函数下一段还能用。' +
      '执行完场景自动保存，用户网页上的预览随之刷新。返回 print 的输出、报错（只含你的代码那一段的栈）和执行后的物体列表。' +
      '大的模型分几步做：先搭主体，看一眼结果，再加细节和材质。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '要执行的 bpy 代码' },
      },
      required: ['code'],
    },
    call: async (args, ctx) => {
      const code = String(args.code ?? '')
      if (!code.trim()) return mcpText('code 是空的', true)
      const r = await runPython(ctx.taskId, code)
      const out = [
        r.ok ? '执行成功。' : '执行出错（场景已经按执行到出错为止的样子保存）。',
        r.output.trim() ? `输出：\n${r.output.trim()}` : '',
        r.error ? `报错：\n${r.error.trim()}` : '',
        r.meta.exportError ? `导出预览失败：${r.meta.exportError}` : '',
        `现在的场景（第 ${r.meta.version} 版，用户网页上已刷新）：\n${sceneText(r.meta.objects)}`,
      ]
      return mcpText(out.filter(Boolean).join('\n\n'), !r.ok)
    },
  },
  {
    name: 'blender_scene',
    description: '看现在场景里有哪些物体：名字、类型、位置、尺寸（米）、父级、面数、材质和修改器。',
    inputSchema: { type: 'object', properties: {} },
    call: async (_args, ctx) => mcpText(sceneText(await sceneObjects(ctx.taskId))),
  },
]
