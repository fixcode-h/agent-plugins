import { t } from '../../../host.ts'
import { isA } from '../pick.ts'
import type { LayoutDef } from '../types.ts'

/** Niagara 系统（设计稿第 3 节、效果图 B10 简版）：左发射器列表、中间预览、右细节（选中发射器看发射器） */
export const niagaraDef: LayoutDef = {
  id: 'niagara',
  label: () => t('Niagara：发射器 + 预览 + 细节'),
  classes: () => ['NiagaraSystem', 'NiagaraEmitter'],
  priority: 30,
  match: (i) =>
    !i.path.includes(':') &&
    (isA(i, 'NiagaraSystem') || isA(i, 'NiagaraEmitter') || /^Niagara(System|Emitter)$/.test(i.cls ?? '')),
  regions: [
    { id: 'emitters', label: () => t('发射器'), place: 'left', size: '300px', min: 200 },
    { id: 'details', label: () => t('细节'), place: 'right', size: '380px', min: 260 },
  ],
}
