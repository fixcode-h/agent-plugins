// 面板开放给插件的模块（sdk/host-modules.json），构建时由 scripts/build.mjs 接到面板那一份。
// ue 插件不照面板源码布局放文件、不从 .panel 取类型，这里只声明用到的那几个函数
declare module '@panel/server/download' {
  export function downloadFile(
    url: string,
    to: string,
    o?: { signal?: AbortSignal; headers?: Record<string, string>; connections?: number; idleMs?: number },
  ): Promise<void>
}
