import type { WebHost } from '../../sdk/web.ts'

/**
 * 面板交来的宿主（activate 时设一次）。组件里用 h() 取：插件不 import 面板源码，
 * 面板组件、数据钩子、接口都从这里拿（面板 web/src/plugins/host.ts）。
 */
let current: WebHost | undefined

export function setHost(x: WebHost) {
  current = x
}

export function h(): WebHost {
  if (!current) throw new Error('UE 插件还没有激活')
  return current
}

/** 界面文案：中文原文当键，英文在包里的 locales/en.json */
export const t = (zh: string, vars?: Record<string, string | number>) => h().t(zh, vars)
