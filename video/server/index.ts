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
    // 作用和使用时机（面板插件接口 8）：设置 →「MCP」显示，面板也补在说明后面交给 Agent
    guide: {
      title: '视频截帧',
      summary: '从视频里截取画面（按时间点或按画面变化挑帧），图片返回给 Agent 看',
      useWhen: '用户给了录屏或视频、要你看里面发生了什么（复现步骤、动画表现、报错画面）时',
      avoidWhen: '用户已经截好图贴进对话时直接看图，不用再截',
      group: '视频',
    },
  }
  const summary = '从用户给的视频里截帧给 Agent 看，帧存在这个对话自己的目录里。'
  return {
    fetch: (req) => app.fetch(req),
    // 帧写进这个对话自己的目录，派出的一次性子任务、工作流节点不给（PluginRun.conversation，插件接口 6）
    tools: (run) =>
      run.conversation
        ? { servers: [{ name: 'video', summary, tools: () => [tool] }] }
        : { skip: ctx.t('派出的一次性子任务和工作流节点不给，只给用户在聊的对话') },
    catalog: () => ({
      servers: [
        {
          name: 'video',
          summary,
          attach: ctx.t('用户在聊的对话（父对话、子对话、Chat 页）；派出的子任务和工作流节点不挂'),
          tools: () => [tool],
        },
      ],
    }),
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
