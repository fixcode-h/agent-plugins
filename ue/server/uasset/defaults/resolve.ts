import type { Asset } from '../../../shared/uasset/asset.ts'
import {
  archetypePath,
  classDefaultOf,
  mergeLayer,
  subPath,
  type LayerProp,
  type OwnProp,
} from '../../../shared/uasset/inherit.ts'
import type { UObj } from '../../../shared/uasset/objects.ts'
import type { RawProp } from '../../../shared/uasset/props.ts'
import type { UeProject } from '../../types.ts'
import { t } from '../../util.ts'
import { findObject, loadAsset } from '../read.ts'
import { clean, propInfo } from '../offline/shape.ts'
import { nativeDefaults, wantNative } from './native-cache.ts'

/**
 * 离线读属性时把原型链垫在文件里的值下面（shared/uasset/inherit.ts 说了原型在哪）：父蓝图、组件类蓝图在磁盘上，读它们的文件；
 * 一路走到 C++ 类，用编辑器开着时记下的默认值（native-cache.ts），没记过的记进 missing，告诉用户开一次编辑器就能补上。
 */

export interface Layer {
  props: LayerProp[]
  /** 还没记下的 C++ 默认对象（/Script/Engine.Default__CapsuleComponent） */
  missing: string[]
  /** 原型链上读不了的文件（父蓝图是烘焙过的、更新的引擎格式……） */
  unread: string[]
}

const empty = (): Layer => ({ props: [], missing: [], unread: [] })
const MAX_DEPTH = 16

type Own = OwnProp & { raw: RawProp }

const ownOf = (o: UObj): Own[] =>
  o.props.map((p) => ({ name: p.name, type: p.type, arrayIndex: p.arrayIndex, value: clean(p.value), raw: p }))

/** 下层没有这条属性时（下层没记下、或者是蓝图变量）用文件里的类型信息 */
function ownMeta(p: OwnProp) {
  const { name: _n, value: _v, readOnly: _r, readOnlyWhy: _w, ...meta } = propInfo((p as Own).raw, 0, '')
  return meta
}

/** 对象的完整属性：原型链合好的 + 自己文件里改过的（标 changed） */
export async function fullProps(project: UeProject, a: Asset, o: UObj): Promise<Layer> {
  const base = await baseOf(project, a, o, 0)
  return { ...base, props: mergeLayer(base.props, ownOf(o), ownMeta) }
}

/** 原型合好的属性：先按位置找原型，找不到用自己类的默认对象 */
async function baseOf(project: UeProject, a: Asset, o: UObj, depth: number): Promise<Layer> {
  for (const p of [archetypePath(a, o), classDefaultOf(a, o)]) {
    if (!p || p === o.path) continue
    const hit = await lookup(project, p, depth)
    if (hit) return hit
  }
  return empty()
}

/** Outer:Sub.Inner → [Outer:Sub, Inner]；Pkg.Obj:Sub → [Pkg.Obj, Sub] */
function splitSub(p: string): [string, string] | undefined {
  const colon = p.indexOf(':')
  if (colon < 0) return undefined
  const dot = p.lastIndexOf('.')
  const at = dot > colon ? dot : colon
  return [p.slice(0, at), p.slice(at + 1)]
}

/** 按路径取一个对象合好的属性；这个对象不存在返回 undefined（调用方换下一个候选） */
async function lookup(project: UeProject, objPath: string, depth: number): Promise<Layer | undefined> {
  if (depth > MAX_DEPTH) return undefined
  if (objPath.startsWith('/Script/')) {
    // C++ 类只有类默认对象和它下面的子对象（C++ 组件）：生成类下面的组件模板（X_GEN_VARIABLE）在 C++ 父类里不会有
    if (!/\.Default__/.test(objPath)) return undefined
    const e = await nativeDefaults(project.id, objPath)
    if (!e) {
      await wantNative(project.id, objPath)
      return { ...empty(), missing: [objPath] }
    }
    return e.missing ? undefined : { ...empty(), props: e.props ?? [] }
  }
  const pkg = objPath.split('.')[0]
  let a: Asset
  try {
    a = (await loadAsset(project, pkg)).asset
  } catch {
    return { ...empty(), unread: [pkg] }
  }
  const x = a.byPath.get(objPath) ?? (objPath.includes('.') ? findObject(a, objPath) : undefined)
  if (!x) {
    // 原型链上这一层没有这个子对象（父蓝图没改过从更上层继承来的组件）：去这一层的原型下面找同名的
    const parts = splitSub(objPath)
    const outer = parts && findObject(a, parts[0])
    const up = outer && archetypePath(a, outer)
    return up ? lookup(project, subPath(up, parts[1]), depth + 1) : undefined
  }
  const base = await baseOf(project, a, x, depth + 1)
  return { ...base, props: mergeLayer(base.props, ownOf(x), ownMeta) }
}

/** 给网页和 Agent 看的一句：原型链补得怎么样 */
export function layerNote(l: Layer): string {
  const out: string[] = []
  if (l.missing.length) {
    const names = [
      ...new Set(
        l.missing.map((p) =>
          p
            .split('.')
            .pop()!
            .replace(/^Default__/, ''),
        ),
      ),
    ]
    out.push(
      t('{names} 的 C++ 默认值还没记下，没改过的属性没列出来：编辑器开着时面板会自动记下，以后编辑器没开也能看全', {
        names: names.slice(0, 3).join('、') + (names.length > 3 ? '…' : ''),
      }),
    )
  } else out.push(t('没改过的属性用的是上次编辑器开着时记下的 C++ 默认值，C++ 改过还没重开编辑器的话可能是旧的'))
  if (l.unread.length) out.push(t('父类 {p} 的文件读不了，它改过的默认值没算进来', { p: l.unread[0] }))
  return out.join('；')
}
