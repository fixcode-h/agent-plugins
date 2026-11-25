import { readFile } from 'node:fs/promises'
import { UassetError } from '../../../shared/uasset/errors.ts'
import { fileSnapshot } from '../../../shared/uasset/snap.ts'
import { snapToText } from '../../../shared/uasset/snap-text.ts'
import { t } from '../../util.ts'
import { OfflineReadError } from '../read.ts'
import { registerOffline } from './registry.ts'

/**
 * 评审看 .uasset 改了什么（server/textify.ts 交过来那一版的临时文件）：编辑器没开时直接读字节转文本，
 * 不为评审起后台编辑器。读不了时抛 OfflineReadError，照旧交给 UE
 */
registerOffline(
  'asset.textify',
  async ({ args }) => {
    const data = await readFile(String(args.file)).catch(() => null)
    if (!data) throw new OfflineReadError(t('读不到临时文件 {f}', { f: String(args.file) }))
    try {
      return { text: snapToText(fileSnapshot(new Uint8Array(data))) }
    } catch (e) {
      throw new OfflineReadError(e instanceof UassetError ? e.message : (e as Error).message)
    }
  },
  (args) => typeof args.file === 'string' && !!args.file,
)
