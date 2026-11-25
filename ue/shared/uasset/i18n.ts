/**
 * 读取器的报错会原样显示给用户和 Agent，要走插件的翻译；shared 里拿不到服务端的 ctx.t，
 * 所以由服务端启动时注入（server/uasset/index.ts 调 setUassetT），没注入时（单测、演示版）按中文原文填变量。
 */
type Tr = (zh: string, vars?: Record<string, string | number>) => string

const fill: Tr = (zh, vars) => zh.replace(/\{(\w+)\}/g, (m, k: string) => (vars && k in vars ? String(vars[k]) : m))
let impl: Tr = fill

export const t: Tr = (zh, vars) => impl(zh, vars)

export function setUassetT(fn: Tr) {
  impl = fn
}
