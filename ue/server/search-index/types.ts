/**
 * 跳转弹窗的本地索引（设计稿：用户 2026-11-16「全局搜索应该先建一步索引，而不是跳到对应的页面查」）。
 * 网页打开跳转时取一次，打字只在网页里筛，不发请求、不碰 UE。为了 5000+ 资源时包小，一条资源是个短数组
 */

/** [对象路径 /Game/A/BP_X.BP_X, 类名（认不出是空串；.umap 是 World）, 蓝图的父类（可选）] */
export type IndexAsset = [string, string] | [string, string, string]

/** [Lua 模块名 UI.BagPanel, 文件的绝对路径] */
export type IndexLua = [string, string]

/** 索引从哪来：UEToVS 建好的文件，或面板自己扫的磁盘 */
export type IndexSource = 'uetovs' | 'disk'

export interface SearchIndex {
  /** 内容变了才变；网页带着上次的版本来问，没变就只回 same */
  version: string
  assets: IndexAsset[]
  lua: IndexLua[]
  source: { assets: IndexSource; lua: IndexSource | 'none' }
  /** 用了 UEToVS 的哪个文件（界面上提示「来自 UEToVS」时用） */
  files: { assets?: string; lua?: string }
  builtAt: string
  /** 建索引花的毫秒数 */
  ms: number
}

/** 挂载点：/Game → <项目>/Content，/<插件> → 插件的 Content */
export type Mounts = { mount: string; dir: string }[]
