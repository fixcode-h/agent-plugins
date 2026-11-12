import { Hono } from 'hono'
import type { ActivateServer, McpTool } from '../../sdk/server.ts'
import { VIDEO_TOOL } from './video/agent-tool.ts'
import { cancelFfmpegDownload, ffmpegStatus } from './video/ffmpeg.ts'
import { videoApi } from './video/routes.ts'

/**
 * 视频截帧插件的服务端入口（面板插件接口 6，ADR 0059）：截帧弹窗的接口挂在 /api/plugins/video/api/video/ 下，
 * 给 Agent 的截帧工具 video_frames 走插件的 MCP 工具（只给用户在聊的对话，和原来面板自带时一样）。
 *
 * 数据还放在数据目录原来的位置（video/ 下的 FFmpeg 和设置、video-frames/ 下的截帧记录）：原来面板自带时就在那里，
 * 已经下载的 FFmpeg（几十 MB）和截过的帧接着用，不用挪；截帧记录里存的是帧图片的绝对路径，挪了反而对不上。
 */
const activate: ActivateServer = (ctx) => {
  const app = new Hono().route('/video', videoApi())
  const tool: McpTool = {
    name: VIDEO_TOOL.name,
    description: VIDEO_TOOL.description,
    inputSchema: VIDEO_TOOL.inputSchema,
    // 截帧要跑 FFmpeg，长视频按画面变化挑点要分析一阵；用户停止对话时 signal 会停掉 FFmpeg
    call: async (args, c) => (await import('./video/agent-frames.ts')).callVideoTool(c.taskId, args, c.signal),
  }
  return {
    fetch: (req) => app.fetch(req),
    // 帧写进这个对话自己的目录，派出的一次性子任务、工作流节点不给（PluginRun.conversation，插件接口 6）
    tools: (run) => (run.conversation ? { servers: [{ name: 'video', tools: () => [tool] }] } : undefined),
    status: async () => {
      const s = await ffmpegStatus()
      return { FFmpeg: s.path ? `${s.version} ${s.path}`.trim() : ctx.t('没找到，打开截帧弹窗时可以下载') }
    },
    stop: () => {
      cancelFfmpegDownload()
    },
  }
}

export default activate
