import type { GmObject } from '../../shared/gm/schema.ts'
import type { GtRef } from '../../shared/gt-script/ref/types.ts'
import { pget, ppost } from '../api.ts'
import { h, t } from '../host.ts'
import { keep } from '../keep.ts'

/**
 * 对象库（objects.json）的两个常用动作：测试页抓到的、暂停时变量里的对象「存进对象库」「在 GM 对象调用里打开」都走这里，
 * 不在各处各写一份读改写
 */

/** 实例 → 对象：类 + 对象名（GameTest 2.2.2 的 @:name），之后按它现找；值树里的 {$obj, class, name} 用它 */
export function objOfInstance(v: { $obj: string; class?: string; name?: string }): GmObject {
  const name = v.name || v.$obj.split(/[.:]/).pop() || 'obj'
  const cls = v.class || 'Object'
  return { name, ref: { class: cls, ident: [{ prop: '@:name', op: 'eq', value: name }] } as GtRef }
}

const short = (cls: string) => (cls.split(/[./]/).pop() ?? '').replace(/^lua:/, '').replace(/_C$/, '').replace(/\W/g, '')

/**
 * 存进对象库的「GameTest」文件夹（对象一定要在文件夹里，和 GM 对象列表同一条规矩）。同样的规则已经在库里就不重复存，
 * 返回库里的名字；失败弹提示、返回 undefined
 */
export async function saveObjToLib(project: string, obj: GmObject, quiet = false): Promise<string | undefined> {
  try {
    const lib = await pget<{ objects: GmObject[]; objFolders: string[] }>(project, 'objlib')
    const same = lib.objects.find((o) => JSON.stringify(o.ref ?? o.src) === JSON.stringify(obj.ref ?? obj.src))
    if (same) {
      if (!quiet) h().toast.success(t('对象库里已经有它了：「{n}」', { n: same.name }))
      return same.name
    }
    const base = obj.name || short(String((obj.ref as { class?: string } | undefined)?.class ?? '')) || 'obj'
    let name = base
    for (let i = 2; lib.objects.some((o) => o.name === name); i++) name = `${base}${i}`
    await ppost(project, 'objlib', {
      objects: [...lib.objects, { ...obj, name, folder: obj.folder ?? 'GameTest' }],
      objFolders: lib.objFolders.includes('GameTest') ? lib.objFolders : [...lib.objFolders, 'GameTest'],
    })
    if (!quiet) h().toast.success(t('存进了对象库「GameTest/{n}」', { n: name }))
    return name
  } catch (e) {
    h().toast.error((e as Error).message)
    return undefined
  }
}

/**
 * 在 GM 页的对象调用里打开（要存成 GM、反复调、钉住属性时用完整的工作台）：先存进对象库，
 * 再把 GM 页切到「对象调用」并选中它（GM 页记选中对象、分类的两个键，见 use-objcall-state.tsx、GmPage.tsx）
 */
export async function openObjCall(project: string, obj: GmObject, go: (section: string) => void) {
  const name = await saveObjToLib(project, obj, true)
  if (!name) return false
  keep(`gm-obj/${project}`, name)
  try {
    localStorage.setItem('ue:gm:cat', JSON.stringify('objcall'))
  } catch {
    // 存不了本机偏好时只是不自动切到对象调用，对象已经在库里了
  }
  go('gm')
  return true
}
