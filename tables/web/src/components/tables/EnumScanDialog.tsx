import { useEffect, useMemo, useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { t } from '@shared/i18n'
import { EnumScan, type ScanFrom, type ScanRun } from '@shared/table-enum-scan'
import { Button } from '@/components/ui/button'
import { ComboInput, Field, Input, Select } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Segmented } from '@/components/ui/segmented'
import { tablesApi } from '@/lib/tables-api'
import { ScanPreview, scanKindLabel } from './EnumScanParts'

type Kind = ScanFrom['kind']

/** 换写法时保留能沿用的字段（文件、页签、列） */
function withKind(from: ScanFrom, kind: Kind): ScanFrom {
  const { file, sheet, start, nameCol, valueCol, descCol } = from
  const base = { file, sheet, start, nameCol, valueCol, descCol }
  if (kind === 'sheets') return { ...base, kind, nameFrom: 'sheet' }
  return { ...base, kind, enumCol: from.kind === 'sheets' ? 'A' : from.enumCol }
}

/** 文件名建议：最多列 50 个，按输入的字筛（5000 张表的项目一次全列会卡） */
function useFileSuggestions(projectId: string, typed: string) {
  const [files, setFiles] = useState<string[]>([])
  useEffect(() => {
    let live = true
    tablesApi
      .list(projectId)
      .then((ix) => live && setFiles(ix.files.map((f) => f.path)))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [projectId])
  const q = typed.trim().toLowerCase()
  return useMemo(
    () =>
      (q ? files.filter((f) => f.toLowerCase().includes(q)) : files.filter((f) => /enum|枚举/i.test(f)))
        .slice(0, 50)
        .map((value) => ({ value })),
    [files, q],
  )
}

/** 选好的文件有哪些页签：试跑前就能从下拉里挑 */
function useSheetNames(projectId: string, file: string) {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    setNames([])
    if (!/\.(xlsx|xlsm|csv|tsv)$/i.test(file.trim())) return
    let live = true
    const timer = setTimeout(() => {
      tablesApi
        .open(projectId, file.trim())
        .then((d) => live && setNames(d.sheets.map((s) => s.name)))
        .catch(() => undefined)
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [projectId, file])
  return names
}

/**
 * 新建 / 改一条枚举扫描规则：选文件和页签、写法、哪几列，试跑看扫出了什么，保存后马上扫一次。
 * 列可以写 Excel 列号（A、B、C）或表头里的字段名；枚举页签多半没有表头，写列号最省事
 */
export function EnumScanDialog({
  projectId,
  initial,
  onClose,
  onSave,
}: {
  projectId: string
  initial: EnumScan
  onClose: () => void
  onSave: (s: EnumScan) => Promise<void>
}) {
  const [rule, setRule] = useState(initial)
  const [run, setRun] = useState<ScanRun | null>(null)
  const [trying, setTrying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const from = rule.from
  const setFrom = (p: Partial<ScanFrom>) => setRule((r) => ({ ...r, from: { ...r.from, ...p } as ScanFrom }))
  const files = useFileSuggestions(projectId, from.file)
  const sheets = useSheetNames(projectId, from.file)
  const parsed = EnumScan.safeParse(rule)
  const ready =
    parsed.success && !!from.file.trim() && !!from.nameCol.trim() && (from.kind === 'sheets' || !!from.enumCol.trim())

  const tryIt = async () => {
    if (!parsed.success) return
    setTrying(true)
    setErr('')
    try {
      setRun(await tablesApi.enumScanTry(projectId, parsed.data))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setTrying(false)
    }
  }
  const col = (k: 'enumCol' | 'nameCol' | 'valueCol' | 'descCol', label: string, ph: string, optional = false) => (
    <Field label={label}>
      <Input
        size="sm"
        placeholder={ph}
        className="tb:font-mono"
        value={((from as Record<string, unknown>)[k] as string | undefined) ?? ''}
        onChange={(e) => setFrom({ [k]: optional ? e.target.value || undefined : e.target.value } as Partial<ScanFrom>)}
      />
    </Field>
  )

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={initial.name ? t('扫描规则 · {name}', { name: initial.name }) : t('新建枚举扫描')}
      size="lg"
      footer={
        <>
          <span className="tb:mr-auto tb:text-footnote tb:text-subtle">{t('只读源文件，表格文件不改')}</span>
          <Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            disabled={!ready || saving}
            onClick={async () => {
              if (!parsed.success) return
              setSaving(true)
              await onSave(parsed.data).finally(() => setSaving(false))
            }}
          >
            {saving && <Loader2 className="tb:h-3.5 tb:w-3.5 tb:animate-spin" />}
            {t('保存并扫描')}
          </Button>
        </>
      }
    >
      <div className="tb:flex tb:flex-col tb:gap-4">
        <div className="tb:grid tb:gap-3 tb:md:grid-cols-2">
          <Field label={t('名字')}>
            <Input
              size="sm"
              value={rule.name}
              placeholder={t('比如 EnumType 页签')}
              onChange={(e) => setRule((r) => ({ ...r, name: e.target.value }))}
            />
          </Field>
          <Field
            label={t('什么时候扫')}
            tip={t('打开时：进表格页、打开或保存了这个文件时，看它的修改时间变没变，变了才重新扫。')}
          >
            <div>
              <Segmented
                label={t('什么时候扫')}
                size="sm"
                value={rule.auto}
                onChange={(auto) => setRule((r) => ({ ...r, auto }))}
                options={[
                  { id: 'open', label: t('打开时自动') },
                  { id: 'off', label: t('只手动') },
                ]}
              />
            </div>
          </Field>
        </div>

        <Field label={t('写法')}>
          <div>
            <Segmented
              label={t('写法')}
              size="sm"
              value={from.kind}
              onChange={(k) => setRule((r) => ({ ...r, from: withKind(r.from, k) }))}
              options={(['block', 'rows', 'sheets'] as const).map((id) => ({ id, label: scanKindLabel(id) }))}
            />
          </div>
        </Field>
        <p className="tb:-mt-2 tb:text-caption tb:leading-relaxed tb:text-subtle">
          {from.kind === 'block'
            ? t('枚举名只写在每组第一行，下面几行枚举名那列空着，都属于上面那个枚举。')
            : from.kind === 'rows'
              ? t('每一行都写着枚举名和成员名。')
              : t('每个页签是一个枚举，页签名（或文件名）就是枚举名。')}
        </p>

        <div className="tb:grid tb:gap-3 tb:md:grid-cols-[2fr_1fr_90px]">
          <Field label={t('文件')}>
            <ComboInput
              size="sm"
              value={from.file}
              suggestions={files}
              placeholder="Config/Enum.xlsx"
              className="tb:font-mono"
              onChange={(file) => setFrom({ file })}
            />
          </Field>
          <Field label={from.kind === 'sheets' ? t('页签（通配）') : t('页签')}>
            {from.kind !== 'sheets' && sheets.length ? (
              <Select
                size="sm"
                value={from.sheet}
                onChange={(e) => setFrom({ sheet: e.target.value })}
                options={[{ value: '', label: t('第一个页签') }, ...sheets.map((s) => ({ value: s, label: s }))]}
              />
            ) : (
              <Input
                size="sm"
                value={from.sheet}
                placeholder={from.kind === 'sheets' ? '*' : t('第一个页签')}
                onChange={(e) => setFrom({ sheet: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('起始行')} tip={t('不填：列都写列号时从第 1 行开始，写了字段名时从表头下面开始。')}>
            <Input
              size="sm"
              inputMode="numeric"
              value={from.start ?? ''}
              placeholder="1"
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10)
                setFrom({ start: Number.isFinite(n) && n > 0 ? n : undefined })
              }}
            />
          </Field>
        </div>

        <div className="tb:grid tb:grid-cols-2 tb:gap-3 tb:md:grid-cols-4">
          {from.kind === 'sheets' ? (
            <Field label={t('枚举名取')}>
              <Select
                size="sm"
                value={from.nameFrom}
                onChange={(e) => setFrom({ nameFrom: e.target.value as 'sheet' | 'file' })}
                options={[
                  { value: 'sheet', label: t('页签名') },
                  { value: 'file', label: t('文件名') },
                ]}
              />
            </Field>
          ) : (
            col('enumCol', t('枚举名列'), 'A')
          )}
          {col('nameCol', t('成员名列'), 'B')}
          {col('valueCol', t('值列（可不填）'), 'C', true)}
          {col('descCol', t('说明列（可不填）'), 'D', true)}
        </div>

        <div className="tb:grid tb:grid-cols-2 tb:gap-3">
          <Field
            label={t('去掉前缀')}
            tip={t('表格里写的枚举名比源头少个前缀时用，比如源头叫 EColor、表格里写 Color。')}
          >
            <Input
              size="sm"
              className="tb:font-mono"
              value={rule.rename.stripPrefix}
              placeholder="E"
              onChange={(e) => setRule((r) => ({ ...r, rename: { ...r.rename, stripPrefix: e.target.value } }))}
            />
          </Field>
          <Field label={t('加上前缀')}>
            <Input
              size="sm"
              className="tb:font-mono"
              value={rule.rename.addPrefix}
              onChange={(e) => setRule((r) => ({ ...r, rename: { ...r.rename, addPrefix: e.target.value } }))}
            />
          </Field>
        </div>

        <div className="tb:flex tb:flex-col tb:gap-2 tb:border-t tb:pt-3">
          <div className="tb:flex tb:items-center tb:gap-2">
            <Button size="sm" variant="secondary" disabled={!ready || trying} onClick={tryIt}>
              {trying ? (
                <Loader2 className="tb:h-3.5 tb:w-3.5 tb:animate-spin" />
              ) : (
                <Play className="tb:h-3.5 tb:w-3.5" />
              )}
              {t('试跑')}
            </Button>
            <span className="tb:text-caption tb:text-subtle">{t('按现在填的扫一遍看看，不保存')}</span>
          </div>
          {err && <p className="tb:text-footnote tb:text-danger">{err}</p>}
          {run && <ScanPreview run={run} />}
        </div>
      </div>
    </Modal>
  )
}
