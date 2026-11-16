// 面板开放给插件的模块（sdk/host-modules.json），构建时由 scripts/build.mjs 接到面板那一份。
// ue 插件不照面板源码布局放文件、不从 .panel 取类型，这里只声明用到的那几个函数
declare module '@panel/server/download' {
  export function downloadFile(
    url: string,
    to: string,
    o?: { signal?: AbortSignal; headers?: Record<string, string>; connections?: number; idleMs?: number },
  ): Promise<void>
}

// 网页：面板的接口请求（带访问令牌、出错抛出接口给的原因）。GM 参数下拉经面板动作入口 /actions/table.* 读表格插件的数据
declare module '@panel/web/src/lib/api' {
  export function request<T>(url: string, init?: RequestInit): Promise<T>
}

/** 面板的拼音首字母（GM 页左栏分组按 jszl 这类首字母搜） */
declare module '@panel/shared/pinyin' {
  export function pinyinInitials(s: string): string
}
