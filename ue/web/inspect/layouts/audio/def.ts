import { t } from '../../../host.ts'
import { isA } from '../pick.ts'
import type { LayoutDef } from '../types.ts'

/**
 * 音频（设计稿第 3 节、效果图 B7）：中间声音信息（时长、采样率、声道；波形要 UELink 导出 PCM，还没有）、右细节；
 * SoundCue 左边多一列声音节点
 */
export const audioDef: LayoutDef = {
  id: 'audio',
  label: () => t('音频：声音信息 + 细节'),
  classes: () => ['SoundWave', 'SoundCue', 'MetaSoundSource'],
  priority: 30,
  match: (i) =>
    !i.path.includes(':') && (isA(i, 'SoundBase') || /^(SoundWave|SoundCue|MetaSoundSource)$/.test(i.cls ?? '')),
  regions: [
    { id: 'nodes', label: () => t('声音节点（SoundCue）'), place: 'left', size: '260px', min: 180, optional: true },
    { id: 'details', label: () => t('细节'), place: 'right', size: '400px', min: 260 },
  ],
}
