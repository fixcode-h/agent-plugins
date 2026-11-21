import { useEffect, useState } from 'react'
import type { GmRef } from '../../../../shared/gm/schema.ts'
import { op } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { t } from '../../../host.ts'
import { useTargetInfo } from '../../../ui.tsx'
import { useRefHits } from '../../uekit/gt-ref/live.ts'
import type { ObjLike } from '../custom/ObjRule.tsx'

/** 项目装了 GameTest、UE 在运行：对象调用、自定义 GM 的命中数和执行都要它（规格第 7 节） */
export function useGameTest() {
  const { state } = useUe()
  const { inst } = useTargetInfo()
  const installed = !!state?.extensions?.some((x) => x.name === 'GameTest')
  return { installed, known: !!state, live: installed && !!inst }
}

/**
 * 一组对象此刻各命中几个：挂在 gt.watch 上收推送（gt-ref/live.ts 的 useRefHits），不轮询。
 * 来源字符串（@pawn）不是匹配规则，不数
 */
export function useObjHits(project: string, live: boolean, objs: { name: string; o: ObjLike }[]) {
  const refs = objs.flatMap((x) => (x.o.ref ? [{ id: x.name, ref: x.o.ref as GmRef & { class: string } }] : []))
  const r = useRefHits(project, live, refs)
  return { hits: r.hits, error: r.error }
}

/** 类名比较用：去掉资源路径、_C、C++ 的 A / U 前缀（AActor 和 Actor 算同一个） */
export const normClass = (c: string) =>
  c
    .replace(/^lua:/, '')
    .replace(/^.*[./]/, '')
    .replace(/_C$/, '')
    .replace(/^[AU](?=[A-Z])/, '')

/**
 * 一个类的祖先链（含自己）：问 GameTest 的 gt.classes（q 按开头匹配，返回命中的和它们的祖先），按项目缓存。
 * GameTest 太旧没有 gt.classes、或没找到这个类时返回 undefined：调用方不置灰，执行时由 UE 报类型不对
 */
const chains = new Map<string, Promise<string[] | undefined>>() // 模块状态：缓存，刷新页面重取
function chainOf(project: string, cls: string, lua: boolean) {
  const k = `${project}|${lua ? 'lua' : 'uobj'}|${cls}`
  let p = chains.get(k)
  if (!p) {
    p = op<{ items?: { name: string; parent?: string }[] }>(project, 'gt.classes', { q: cls, lua, limit: 50 })
      .then((r) => {
        const by = new Map((r.items ?? []).map((i) => [normClass(i.name), i]))
        const out: string[] = []
        for (
          let cur = by.get(normClass(cls));
          cur && out.length < 64;
          cur = cur.parent ? by.get(normClass(cur.parent)) : undefined
        )
          out.push(normClass(cur.name))
        return out.length ? out : undefined
      })
      .catch(() => undefined)
    chains.set(k, p)
  }
  return p
}

/** 参数要的类型：UObject 的类名，或 Lua 类（`lua:模块`） */
export interface ParamClass {
  cls: string
  lua: boolean
}

/**
 * 对象列表里每个对象能不能当这个参数传：类型对不上的给原因（下拉里置灰写出来，规格第 7 节）。
 * 只在 GameTest 告诉得了类树时判断；判断不了的都放行
 */
export function useFitness(
  project: string,
  live: boolean,
  want: ParamClass | undefined,
  objs: { name: string; o: ObjLike }[],
) {
  const [why, setWhy] = useState<Record<string, string>>({})
  const sig = JSON.stringify([want, objs.map((x) => [x.name, x.o.src ?? x.o.ref?.class])])
  useEffect(() => {
    // 参数类型不知道（自定义 GM 只存了值）：不判断
    if (!want?.cls) return setWhy({})
    let off = false
    void (async () => {
      const out: Record<string, string> = {}
      for (const { name, o } of objs) {
        const luaObj = !!o.ref?.class.startsWith('lua:') || !!o.src?.startsWith('@luaMod.')
        if (o.src?.startsWith('@luaMod.')) {
          out[name] = want.lua ? t('Lua 模块表不是对象实例') : t('Lua 模块，参数要 {c}', { c: want.cls })
          continue
        }
        if (o.src) continue
        if (want.lua !== luaObj) {
          out[name] = want.lua ? t('参数要 Lua 类 {c}', { c: want.cls }) : t('Lua 对象，参数要 {c}', { c: want.cls })
          continue
        }
        if (!live || !o.ref) continue
        const chain = await chainOf(project, o.ref.class, want.lua)
        if (chain && !chain.includes(normClass(want.cls)))
          out[name] = t('类型不对：是 {c}', { c: chain[chain.length > 1 ? 1 : 0] ?? normClass(o.ref.class) })
      }
      if (!off) setWhy(out)
    })()
    return () => {
      off = true
    }
    // sig 是 want 和对象类的内容；数组每次渲染都是新的
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [project, live, sig])
  return why
}
