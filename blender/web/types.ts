/** 服务端 /status 的结果：找没找到 Blender、在哪、什么版本、为什么不能用 */
export interface BlenderStatus {
  path: string
  version: string
  error: string
}

/** 插件页状态面板的数据（服务端 ServerPlugin.status） */
export interface PluginStatus {
  blenderPath?: string
  blenderVersion?: string
  blenderError?: string
  gatewayRunning?: boolean
  gatewayPort?: number
  gatewayError?: string
  error?: string
}
