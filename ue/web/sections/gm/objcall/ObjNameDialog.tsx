import { useState } from 'react'
import { normFolder } from '../../../../shared/gm/obj-folders.ts'
import { useAsk } from '../../../ask.tsx'
import { h, t } from '../../../host.ts'

const NEW = '§new'
const ASK = '§ask'

export interface ObjNameAsk {
  title: string
  name: string
  /** 默认选的文件夹（右键文件夹「在这里加对象」、选中的对象所在的文件夹） */
  folder?: string
  /** 改名时不问文件夹 */
  noFolder?: boolean
  /** 移到文件夹时不问名字 */
  noName?: boolean
}

/**
 * 加对象、复制、改名时问名字和文件夹（用户 2026-11-22：新增对象必须放进一个文件夹）。
 * 文件夹从已有的里选，或者「＋ 新建文件夹…」直接输入一个新的（可以写 a/b 建多层），保存时才真的建出来。
 * 写法照「保存为 GM」选模块
 */
export function ObjNameDialog({
  req,
  folders,
  taken,
  onClose,
  onOk,
}: {
  req: ObjNameAsk
  folders: string[]
  /** 名字查重：返回错误文字，没问题返回 undefined */
  taken: (name: string) => string | undefined
  onClose: () => void
  onOk: (name: string, folder: string) => void
}) {
  const { ui } = h()
  const [dialog, ask] = useAsk()
  const [name, setName] = useState(req.name)
  const [folder, setFolder] = useState(req.folder && folders.includes(req.folder) ? req.folder : (folders[0] ?? ''))
  const [newFolder, setNewFolder] = useState<string>()
  const err = !req.noName && name.trim() ? taken(name.trim()) : undefined
  const realFolder = folder === NEW ? (newFolder ?? '') : folder
  const ok = (req.noName || (!!name.trim() && !err)) && (req.noFolder || !!realFolder)
  const opts = [
    ...folders.map((f) => ({ value: f, label: f })),
    ...(newFolder ? [{ value: NEW, label: newFolder }] : []),
    { value: ASK, label: t('＋ 新建文件夹…') },
  ]
  const submit = () => ok && onOk(name.trim(), realFolder)
  return (
    <ui.Modal
      open
      size="sm"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={req.title}
      footer={
        <>
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button disabled={!ok} onClick={submit}>
            {t('确定')}
          </ui.Button>
        </>
      }
    >
      {dialog}
      <form
        className="ue:flex ue:flex-col ue:gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {!req.noName && (
          <ui.Field label={t('在对象列表里叫什么（例如：商店界面、店主）')} error={err}>
            <ui.Input autoFocus value={name} onChange={(e: { target: { value: string } }) => setName(e.target.value)} />
          </ui.Field>
        )}
        {!req.noFolder && (
          <ui.Field
            label={t('文件夹')}
            hint={folders.length ? t('每个对象都要放进一个文件夹，没有合适的就新建') : t('还没有文件夹：新建一个')}
          >
            <ui.Select
              value={folder}
              placeholder={t('选一个文件夹')}
              onChange={async (e: { target: { value: string } }) => {
                if (e.target.value !== ASK) return setFolder(e.target.value)
                const n = normFolder(
                  (await ask({ title: t('新建文件夹'), label: t('文件夹的名字（a/b 建多层）'), init: '' })) ?? '',
                )
                if (!n) return
                if (folders.includes(n)) return setFolder(n)
                setNewFolder(n)
                setFolder(NEW)
              }}
              options={opts}
            />
          </ui.Field>
        )}
      </form>
    </ui.Modal>
  )
}
