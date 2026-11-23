import { isObjArg } from '../../../../shared/gm/custom.ts'
import type { GmCustom } from '../../../../shared/gm/schema.ts'
import type { CallParam } from '../../../obj-kit/CallForm.tsx'

/**
 * 自定义 GM 的参数表单：存了 params（函数签名）的按它，保存时没填的参数也在；
 * 旧数据只存了值、没存类型：值是对象写法的就是对象参数（类型不知道，不判断能不能传）
 */
export function customParams(c: Pick<GmCustom, 'args' | 'params'>): CallParam[] {
  if (c.params?.length)
    return c.params.map((p) => ({ name: p.name, type: p.type, ...(p.obj ? { obj: { ...p.obj } } : {}) }))
  return Object.entries(c.args).map(([name, v]) =>
    isObjArg(v) || (typeof v === 'string' && v.startsWith('@'))
      ? { name, type: '', obj: { cls: '', lua: false } }
      : { name, type: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'bool' : '' },
  )
}
