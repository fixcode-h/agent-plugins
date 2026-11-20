import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type {
  GtCloseHow,
  GtCloseRule,
  GtCloseVerify,
  GtIdentRule,
  GtMany,
  GtRefDefaults,
} from '../../../../shared/gt-script/ref/types.ts'
import { h, t } from '../../../host.ts'
import { SettingGroup, SettingRow } from '../../../SettingRows.tsx'
import { CloseHowList, closeHowText, CloseVerify } from './CloseHowList.tsx'
import { inText } from './describe.ts'
import { usePrefs } from './prefs.ts'
import { MANY_OPTIONS } from './RefCard.tsx'
import type { RefConfig } from './rules-io.ts'

/** 设置页存盘前收拾：空行不存，默认值不写 */
export function tidyRefConfig(c: RefConfig): RefConfig {
  const out: RefConfig = {}
  const ident = (c.identRules ?? [])
    .map((r) => ({ ...r, class: r.class.trim(), ident: r.ident.map((x) => x.trim()).filter(Boolean) }))
    .filter((r) => r.class && r.ident.length)
  if (ident.length) out.identRules = ident
  const close = (c.closeRules ?? []).filter((r) => r.class.trim() && r.how.length)
  if (close.length) out.closeRules = close
  const d = { ...(c.refDefaults ?? {}) }
  if (d.many === 'error') delete d.many
  if (d.ignoreCase !== false) delete d.ignoreCase
  if (d.tol && !Object.values(d.tol).some((v) => v !== undefined)) delete d.tol
  if (d.closeVerifyMs === undefined) delete d.closeVerifyMs
  if (Object.keys(d).length) out.refDefaults = d
  if (c.allowDestroy) out.allowDestroy = true
  return out
}

/** 这一页管的字段：保存时以表单为准 */
export const REF_KEYS = ['identRules', 'closeRules', 'refDefaults', 'allowDestroy', 'itemKeys', 'objectKeys'] as const

/**
 * 设置 → GameTest →「对象与标识」（效果图 5，协议第 6 节）：按类记住的标识（identRules，取代条目怎么认 itemKeys
 * 和对象默认标识 objectKeys）、按类记住的关闭方式（closeRules）、默认（命中多个时、忽略大小写、容差、关完核对多久）、
 * 允许销毁 Actor；最后是属性树的显示（个人偏好，只记在本机）。值由 GtSettings 统一读写 _settings.json
 */
export function RefSettings({ value, onChange }: { value: RefConfig; onChange: (v: RefConfig) => void }) {
  const { ui } = h()
  const [prefs, setPrefs] = usePrefs()
  const [closing, setClosing] = useState<number>()
  const idents = value.identRules ?? []
  const closes = value.closeRules ?? []
  const d: GtRefDefaults = value.refDefaults ?? {}
  const setD = (p: Partial<GtRefDefaults>) => onChange({ ...value, refDefaults: { ...d, ...p } })
  const setIdent = (i: number, r: GtIdentRule) =>
    onChange({ ...value, identRules: idents.map((x, k) => (k === i ? r : x)) })
  const setClose = (i: number, r: GtCloseRule) =>
    onChange({ ...value, closeRules: closes.map((x, k) => (k === i ? r : x)) })
  const num = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Number(s) : undefined)
  const head =
    'ue:grid ue:items-center ue:gap-3 ue:border-b ue:border-line/60 ue:px-4 ue:py-2 ue:text-caption ue:text-subtle'
  const rowCls = 'ue:grid ue:items-center ue:gap-3 ue:border-b ue:border-line/40 ue:px-4 ue:py-1.5 ue:text-footnote'
  const identCols = { gridTemplateColumns: 'minmax(0,1fr) minmax(0,0.8fr) minmax(0,1.6fr) minmax(0,0.8fr) 28px' }
  const closeCols = { gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr) 100px 28px' }
  const add = (onClick: () => void) => (
    <ui.Button size="sm" variant="secondary" onClick={onClick}>
      <Plus className="ue:h-3.5 ue:w-3.5" />
      {t('加一条')}
    </ui.Button>
  )
  const cell = (v: string, on: (s: string) => void, ph?: string) => (
    <ui.Input
      size="sm"
      className="ue:w-full ue:font-mono"
      placeholder={ph}
      value={v}
      onChange={(e: { target: { value: string } }) => on(e.target.value)}
    />
  )

  return (
    <>
      <SettingGroup
        page="refs"
        flush
        title={t('按类记住的标识')}
        aside={t('原「条目怎么认」和「对象默认标识」合成这一张')}
        hint={t(
          '录制、从游戏里抓、Agent 写脚本找这个类（按继承）的对象时默认用这些属性当标识；脚本里写了的以脚本为准。',
        )}
        action={add(() => onChange({ ...value, identRules: [...idents, { class: '', ident: [] }] }))}
      >
        <div className={head} style={identCols}>
          <span>{t('类')}</span>
          <span>{t('在哪')}</span>
          <span>{t('标识（逗号隔开）')}</span>
          <span>{t('说明')}</span>
          <span />
        </div>
        {idents.map((r, i) => (
          <div key={i} className={rowCls} style={identCols}>
            {cell(r.class, (s) => setIdent(i, { ...r, class: s }), 'WBP_BagSlot')}
            {typeof r.in === 'object' ? (
              <span className="ue:truncate ue:text-muted">{inText(r.in)}</span>
            ) : (
              cell(r.in ?? '', (s) => setIdent(i, { ...r, in: s || undefined }), t('任意'))
            )}
            {cell(
              r.ident.join(', '),
              (s) => setIdent(i, { ...r, ident: s.split(',').map((x) => x.trim()) }),
              '@item.ItemId',
            )}
            {cell(r.note ?? '', (s) => setIdent(i, { ...r, note: s || undefined }))}
            <ui.IconButton
              size="sm"
              label={t('删掉')}
              onClick={() => onChange({ ...value, identRules: idents.filter((_, k) => k !== i) })}
            >
              <Trash2 className="ue:h-3.5 ue:w-3.5" />
            </ui.IconButton>
          </div>
        ))}
        {!idents.length && (
          <p className="ue:px-4 ue:py-3 ue:text-footnote ue:text-subtle">
            {t('还没有：对象弹窗里勾「以后抓这个类默认选这几项」会加到这里')}
          </p>
        )}
      </SettingGroup>

      <SettingGroup
        page="refs"
        flush
        title={t('按类记住的关闭方式')}
        aside={t('脚本和守护里「关闭」没写方式时用')}
        action={add(() => {
          onChange({ ...value, closeRules: [...closes, { class: '', how: [] }] })
          setClosing(closes.length)
        })}
      >
        <div className={head} style={closeCols}>
          <span>{t('类')}</span>
          <span>{t('依次试')}</span>
          <span>{t('关完核对')}</span>
          <span />
        </div>
        {closes.map((r, i) => (
          <div key={i} className={rowCls} style={closeCols}>
            {cell(r.class, (s) => setClose(i, { ...r, class: s }), 'WBP_Guide')}
            <button
              type="button"
              onClick={() => setClosing(i)}
              className="ue:cursor-pointer ue:truncate ue:text-left ue:text-fg ue:hover:text-accent"
            >
              {closeHowText(r.how) || t('点这里加方式')}
            </button>
            <span className="ue:text-muted">{verifyText(r.verify)}</span>
            <ui.IconButton
              size="sm"
              label={t('删掉')}
              onClick={() => onChange({ ...value, closeRules: closes.filter((_, k) => k !== i) })}
            >
              <Trash2 className="ue:h-3.5 ue:w-3.5" />
            </ui.IconButton>
          </div>
        ))}
        {!closes.length && (
          <p className="ue:px-4 ue:py-3 ue:text-footnote ue:text-subtle">
            {t('还没有：没写方式时按推荐（像关闭的函数 → 关闭按钮 → CommonUI 弹出 → 移除）')}
          </p>
        )}
      </SettingGroup>

      <SettingGroup page="refs" title={t('默认')}>
        <SettingRow title={t('命中多个时')} desc={t('「第一个」容易悄悄点错，默认报错并列出每个的标识值')}>
          <ui.Segmented
            size="sm"
            label={t('命中多个时')}
            value={d.many ?? 'error'}
            onChange={(m: GtMany) => setD({ many: m })}
            options={MANY_OPTIONS()}
          />
        </SettingRow>
        <SettingRow title={t('文字比较')} desc={t('标识和判断里比文字时')}>
          <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-2 ue:text-body ue:text-fg">
            <input
              type="checkbox"
              className="ue:accent-accent"
              checked={d.ignoreCase !== false}
              onChange={(e) => setD({ ignoreCase: e.target.checked ? undefined : false })}
            />
            {t('忽略大小写')}
          </label>
        </SettingRow>
        <SettingRow title={t('相等的容差')} desc={t('浮点 · 向量（厘米）· 旋转（度）· 颜色每通道')}>
          <div className="ue:grid ue:grid-cols-4 ue:gap-1.5">
            {(
              [
                ['float', '0.001'],
                ['vector', '10'],
                ['rotator', '1'],
                ['color', '0.02'],
              ] as const
            ).map(([k, ph]) => (
              <ui.Input
                key={k}
                size="sm"
                className="ue:w-full ue:font-mono"
                placeholder={ph}
                title={k}
                value={d.tol?.[k] === undefined ? '' : String(d.tol[k])}
                onChange={(e: { target: { value: string } }) => setD({ tol: { ...d.tol, [k]: num(e.target.value) } })}
              />
            ))}
          </div>
        </SettingRow>
        <SettingRow title={t('关闭后核对等多久')} desc={t('毫秒；关闭步骤自己写了的以步骤为准')}>
          <ui.Input
            size="sm"
            className="ue:w-full ue:font-mono"
            placeholder="2000"
            value={d.closeVerifyMs === undefined ? '' : String(d.closeVerifyMs)}
            onChange={(e: { target: { value: string } }) => setD({ closeVerifyMs: num(e.target.value) })}
          />
        </SettingRow>
        <SettingRow title={t('允许关闭方式「销毁 Actor」')} desc={t('默认关：销毁了就回不来')}>
          <ui.Select
            size="sm"
            className="ue:w-full"
            value={value.allowDestroy ? 'on' : 'off'}
            onChange={(e: { target: { value: string } }) =>
              onChange({ ...value, allowDestroy: e.target.value === 'on' })
            }
            options={[
              { value: 'off', label: t('不允许（默认）') },
              { value: 'on', label: t('允许') },
            ]}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup page="refs" title={t('属性树')} aside={t('只记在这台电脑上')}>
        <SettingRow title={t('行高')} desc={t('像素，默认 28；在「控件样式」里能看到效果')}>
          <ui.Input
            size="sm"
            className="ue:w-full ue:font-mono"
            inputMode="numeric"
            value={String(prefs.rowH)}
            onChange={(e: { target: { value: string } }) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n >= 22 && n <= 44) setPrefs({ rowH: Math.round(n) })
            }}
          />
        </SettingRow>
        <SettingRow title={t('「同类里」列')} desc={t('同类的其他实例这一项是不是各不相同')}>
          <ui.Segmented
            size="sm"
            label={t('「同类里」列')}
            value={prefs.siblings ? 'on' : 'off'}
            onChange={(v: string) => setPrefs({ siblings: v === 'on' })}
            options={[
              { id: 'on', label: t('显示') },
              { id: 'off', label: t('隐藏') },
            ]}
          />
        </SettingRow>
      </SettingGroup>

      {closing !== undefined && closes[closing] && (
        <CloseRuleDialog
          value={closes[closing]}
          allowDestroy={value.allowDestroy}
          onClose={() => setClosing(undefined)}
          onSave={(r) => {
            setClose(closing, r)
            setClosing(undefined)
          }}
        />
      )}
    </>
  )
}

function verifyText(v: GtCloseVerify | undefined) {
  return v === 'hidden' ? t('不在屏上') : v === 'none' ? t('不核对') : t('找不到了')
}

/** 改一条关闭规则：关闭方式列表 + 关完核对 */
function CloseRuleDialog({
  value,
  allowDestroy,
  onClose,
  onSave,
}: {
  value: GtCloseRule
  allowDestroy?: boolean
  onClose: () => void
  onSave: (r: GtCloseRule) => void
}) {
  const { ui } = h()
  const [r, setR] = useState(value)
  return (
    <ui.Modal
      open
      size="lg"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('怎么关 {c}', { c: r.class || t('这个类') })}
      footer={
        <>
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button onClick={() => onSave(r)}>{t('好')}</ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-3">
        <CloseHowList value={r.how} onChange={(how: GtCloseHow[]) => setR({ ...r, how })} allowDestroy={allowDestroy} />
        <span className="ue:text-caption ue:text-subtle">{t('关完核对')}</span>
        <CloseVerify noMs verify={r.verify} onChange={(v) => setR({ ...r, verify: v.verify })} />
      </div>
    </ui.Modal>
  )
}
