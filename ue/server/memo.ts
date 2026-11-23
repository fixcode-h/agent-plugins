/**
 * 派生缓存：都走面板的 server/memo（面板 ADR 0074）——同一个键同时只算一遍、算失败不记、过期或依赖的文件变了才重算，
 * 设置 →「数据」能看到有哪些缓存、一键清空。以前插件里每处手写 Map + 时间戳，各自决定失败记不记、在途去不去重。
 * 面板模块用到时才加载：只测纯逻辑的单测不用拉起面板
 */
import type { Memo, MemoWatch } from '@panel/server/memo/index'

export interface UeMemoOpts<K, V> {
  name: string
  load: (key: K) => Promise<V>
  keyOf?: (key: K) => string
  ttlMs?: number
  max?: number
  watch?: (key: K) => MemoWatch | undefined
}

export function ueMemo<K, V>(o: UeMemoOpts<K, V>) {
  let m: Promise<Memo<K, V>> | undefined
  const memo = () => (m ??= import('@panel/server/memo/index').then(({ createMemo }) => createMemo<K, V>(o)))
  return {
    get: async (key: K, g?: { fresh?: boolean }) => (await memo()).get(key, g),
    invalidate: async (key?: K) => (await memo()).invalidate(key),
  }
}

/** UE 项目里 C++ 头文件所在的两棵树 */
export const headerTrees = (root: string): MemoWatch => ({
  trees: [`${root}/Source`, `${root}/Plugins`],
  exts: ['h'],
})
