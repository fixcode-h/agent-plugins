import { h, t } from '../../host.ts'
import { SettingGroup, SettingRow } from '../../SettingRows.tsx'

/**
 * 运行设置里的「已达成就跳过」一节（GameTest 1.7.0，_settings.json 的 skipIf 段）：总开关、稳住多久才下结论、
 * 做完核对和它等多久。文件里写 false 是整个项目都照做，写对象时只留改过的项；场景顶层的 skipIf 覆盖这里
 */
export interface GtSkipConfig {
  enabled?: boolean
  settleMs?: number
  verify?: boolean
  verifyTimeoutMs?: number
}

/** 文件里的值（false / true / 对象 / 没写）→ 表单 */
export function readSkip(v: unknown): GtSkipConfig {
  if (v === false) return { enabled: false }
  if (v && typeof v === 'object' && !Array.isArray(v)) return { ...(v as GtSkipConfig) }
  return {}
}

/** 表单 → 文件里的值：全是默认时不写；只关了总开关时写 false */
export function tidySkip(c: GtSkipConfig): false | GtSkipConfig | undefined {
  const out: GtSkipConfig = {}
  if (c.settleMs !== undefined && c.settleMs !== 300) out.settleMs = c.settleMs
  if (c.verify === false) out.verify = false
  if (c.verifyTimeoutMs !== undefined && c.verifyTimeoutMs !== 5000) out.verifyTimeoutMs = c.verifyTimeoutMs
  if (c.enabled === false) return Object.keys(out).length ? { enabled: false, ...out } : false
  return Object.keys(out).length ? out : undefined
}

const sec = (ms: number | undefined, d: number) => String((ms ?? d) / 1000)
const toMs = (v: string, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.min(max, Math.round(n * 1000)) : undefined
}

export function GtSkipSettings({ value, onChange }: { value: GtSkipConfig; onChange: (v: GtSkipConfig) => void }) {
  const { ui } = h()
  const set = (p: Partial<GtSkipConfig>) => onChange({ ...value, ...p })
  const on = value.enabled !== false
  return (
    <SettingGroup
      page="skip"
      title={t('已达成就跳过')}
      hint={t(
        '步骤上写了跳过条件（录制时自动加或在步骤详情里加）时，回放到这一步先看一眼：已经是想要的样子（勾已勾上、按钮已是「已领取」）就不做，记成「已达成」，算通过。需要 GameTest 1.7.0；场景顶层写 "skipIf": false 的场景照做，运行按钮旁的「全部照做」只管这一次。',
      )}
    >
      <SettingRow title={t('跳过已达成的步骤')} desc={t('关掉后每一步都照做，也不做完核对')}>
        <ui.Select
          size="sm"
          className="ue:w-full"
          value={on ? 'on' : 'off'}
          onChange={(e: { target: { value: string } }) => set({ enabled: e.target.value === 'on' ? undefined : false })}
          options={[
            { value: 'on', label: t('开（默认）') },
            { value: 'off', label: t('关，全部照做') },
          ]}
        />
      </SettingRow>
      {on && (
        <>
          <SettingRow
            title={t('确认等多久（秒）')}
            desc={t('条件成立或不成立要稳住这么久才下结论')}
            hint={t(
              '怕界面数据晚到：按钮先显示「领取」，服务器回包后才变「已领取」。「不存在 / 不可见」这类条件按两倍算。默认 0.3 秒。',
            )}
          >
            <ui.Input
              size="sm"
              className="ue:w-full"
              inputMode="decimal"
              value={sec(value.settleMs, 300)}
              onChange={(e: { target: { value: string } }) => set({ settleMs: toMs(e.target.value, 10000) })}
            />
          </SettingRow>
          <SettingRow
            title={t('做完核对')}
            desc={t('真做了以后条件要成立，不然这一步失败')}
            hint={t('能发现「点了没反应」。单个步骤可以在详情里关掉。')}
          >
            <ui.Select
              size="sm"
              className="ue:w-full"
              value={value.verify === false ? 'off' : 'on'}
              onChange={(e: { target: { value: string } }) =>
                set({ verify: e.target.value === 'on' ? undefined : false })
              }
              options={[
                { value: 'on', label: t('开（默认）') },
                { value: 'off', label: t('关') },
              ]}
            />
          </SettingRow>
          {value.verify !== false && (
            <SettingRow title={t('核对等多久（秒）')} desc={t('做完后最多等条件成立这么久，默认 5 秒')}>
              <ui.Input
                size="sm"
                className="ue:w-full"
                inputMode="decimal"
                value={sec(value.verifyTimeoutMs, 5000)}
                onChange={(e: { target: { value: string } }) => set({ verifyTimeoutMs: toMs(e.target.value, 120000) })}
              />
            </SettingRow>
          )}
        </>
      )}
    </SettingGroup>
  )
}
